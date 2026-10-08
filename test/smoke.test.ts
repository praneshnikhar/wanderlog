import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsxBin = path.join(root, "node_modules", ".bin", "tsx");
const serverFile = path.join(root, "src", "server.ts");
const dbPath = path.join(os.tmpdir(), `wanderlog-smoke-${process.pid}.db`);

const transport = new StdioClientTransport({
  command: tsxBin,
  args: [serverFile],
  env: {
    ...process.env,
    WANDERLOG_DB: dbPath,
    WANDERLOG_OFFLINE: "1",
    WANDERLOG_OLLAMA_MODEL: "",
  },
  stderr: "pipe",
});

let transportStderr = "";
transport.stderr?.on("data", (chunk: Buffer) => {
  transportStderr += chunk.toString();
});

const client = new Client({ name: "wanderlog-smoke", version: "1.0.0" });

let passed = 0;
function ok(name: string): void {
  passed++;
  console.log(`  ✓ ${name}`);
}

async function main(): Promise<void> {
  console.log("WanderLog smoke test");
  await client.connect(transport);
  const info = await client.getServerCapabilities();
  assert.ok(info, "server capabilities present");
  assert.ok(info.tools, "server advertises tools");
  assert.ok(info.resources, "server advertises resources");
  ok("initialize + capabilities");

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  assert.deepEqual(
    [...names].sort(),
    ["answer_question", "journal_overview", "log_sighting", "log_walk", "log_voice_note", "search_journal"].sort()
  );
  ok(`tools/list → ${names.join(", ")}`);

  const walkRes = await client.callTool({ name: "log_walk", arguments: {
    trail: "Smoke Test Trail",
    distance_km: 2.1,
    duration_min: 40,
    notes: "hermetic test walk",
  }});
  const walkText = extractText(walkRes);
  assert.match(walkText, /Logged walk #1/, "walk logged as #1");
  ok("log_walk");

  const sightingRes = await client.callTool({ name: "log_sighting", arguments: {
    species: "white-breasted kingfisher",
    category: "bird",
    location: "Smoke Lake jetty",
    notes: "test kingfisher",
  }});
  const sightingText = extractText(sightingRes);
  assert.match(sightingText, /Logged sighting #1/, "sighting logged as #1");
  ok("log_sighting");

  const searchRes = await client.callTool({ name: "search_journal", arguments: { query: "kingfisher last time", k: 3 } });
  const searchText = extractText(searchRes);
  assert.match(searchText, /sighting #1/, "search finds the sighting");
  ok("search_journal");

  const overviewRes = await client.callTool({ name: "journal_overview", arguments: {} });
  const overviewText = extractText(overviewRes);
  assert.match(overviewText, /Sightings: 1/, "overview counts sightings");
  assert.match(overviewText, /Walks: 1/, "overview counts walks");
  ok("journal_overview");

  const answerRes = await client.callTool({
    name: "answer_question",
    arguments: { question: "where did I see the kingfisher last time?" },
  });
  const answerText = extractText(answerRes);
  assert.match(answerText, /Smoke Lake jetty/, "evidence cites the location");
  ok("answer_question (evidence fallback, no local LLM)");

  const voiceEmptyRes = await client.callTool({ name: "log_voice_note", arguments: {} });
  assert.match(extractText(voiceEmptyRes), /provide audio_path/, "voice logging requires input");
  ok("log_voice_note rejects empty input");

  const voiceRes = await client.callTool({
    name: "log_voice_note",
    arguments: { transcript: "saw a koel in the neem tree" },
  });
  assert.match(extractText(voiceRes), /no local model/, "voice logging names the missing local model");
  ok("log_voice_note points at the local model when none is running");

  const resourcesRes = await client.listResources();
  ok(`resources/list → ${resourcesRes.resources.map((r) => r.uri).join(", ")}`);

  const statsRes = await client.readResource({ uri: "journal://stats" });
  const stats = JSON.parse(readContentText(statsRes));
  assert.equal(stats.sightingCount, 1, "stats sighting count");
  ok("resources/read journal://stats");

  const dayUri = `journal://day/${new Date().toISOString().slice(0, 10)}`;
  const dayRes = await client.readResource({ uri: dayUri });
  const day = JSON.parse(readContentText(dayRes));
  assert.equal(day.count, 2, "day has walk + sighting");
  ok("resources/read journal://day");

  const categoryRes = await client.readResource({ uri: "journal://category/bird" });
  const category = JSON.parse(readContentText(categoryRes));
  assert.equal(category.count, 1, "bird category has 1");
  ok("resources/read journal://category");

  const walkResourceRes = await client.readResource({ uri: "journal://walk/1" });
  const walkDoc = JSON.parse(readContentText(walkResourceRes));
  assert.equal(walkDoc.walk.id, 1, "walk resource resolves");
  ok("resources/read journal://walk");

  const promptRes = await client.getPrompt({ name: "journal-keeper" });
  assert.ok(promptRes.messages.length >= 1, "prompt returns messages");
  ok("prompts/get journal-keeper");

  await client.close();
  assert.doesNotThrow(() => new Client({ name: "x", version: "1.0.0" }));
  console.log(`\n${passed} checks passed`);
  process.exit(0);
}

function extractText(result: unknown): string {
  const res = result as { content?: { type?: string; text?: string }[] };
  const texts = (res.content ?? []).map((c) => c.text ?? "").join("\n");
  return texts;
}

function readContentText(result: unknown): string {
  const res = result as { contents?: { text?: string }[] };
  const t = (res.contents ?? [])[0]?.text ?? "";
  return t;
}

main().catch(async (err) => {
  console.error("SMOKE TEST FAILED:", err instanceof Error ? err.message : err);
  if (transportStderr) {
    console.error("--- server stderr ---\n" + transportStderr.slice(-2000));
  }
  try {
    await client.close();
  } catch {
    /* already closed */
  }
  process.exit(1);
});