import { openDb } from "../src/db.js";
import { seed } from "../src/seed.js";
import { hybridSearch, sightingText, walkText } from "../src/search.js";
import { generateAnswer, llmAvailable, llmModelName } from "../src/llm.js";
import { modelName, tokenize } from "../src/embeddings.js";
import { insertWalk, insertSighting, overview } from "../src/db.js";
import { ensureEmbeddedFor } from "../src/search.js";

const args = process.argv.slice(2);
const customQuestion = args.includes("--question")
  ? args[args.indexOf("--question") + 1]
  : null;

function hr(): string {
  return "─".repeat(72);
}

async function main(): Promise<void> {
  const db = openDb();

  console.log(hr());
  console.log("  WANDERLOG — local-first field journal, offline demo");
  console.log(hr());

  const seeded = await seed(db, {});
  if (seeded.inserted) {
    console.log(`  seeded demo journal: ${seeded.sightings} sightings / ${seeded.walks} walks (${seeded.embedded} vectors)`);
  } else {
    console.log(`  existing journal in use: ${seeded.sightings} sightings / ${seeded.walks} walks`);
  }

  console.log(`  embedding model : ${modelName()} (open-weight, runs on-device)`);
  console.log(`  local Q&A model : ${(await llmAvailable()) ? llmModelName() : "not configured (keyword/semantic search only)"}`);
  console.log("  network calls    : none. All inference happens in this process.");
  console.log(hr());

  if (!customQuestion) {
    console.log("\n  You come in from the trail and ask your agent (this demo):\n");
    console.log('    "where did I see the kingfisher last time?"\n');
  } else {
    console.log(`\n  Question: "${customQuestion}"\n`);
  }

  const question = customQuestion ?? "where did I see the kingfisher last time?";
  const t0 = Date.now();
  const hits = await hybridSearch(db, question, {});
  const elapsed = Date.now() - t0;

  console.log(`  top results (${elapsed} ms, includes replacement vector computation):\n`);
  for (const [i, h] of hits.slice(0, 5).entries()) {
    const ctx =
      h.kind === "sighting"
        ? `${h.species} at ${h.location}`
        : `walk on ${h.trail}`;
    console.log(
      `   ${String(i + 1).padStart(3, " ")}. [${h.date}] ${h.kind} #${h.id} — ${ctx}`
    );
    console.log(`       score=${h.score.toFixed(3)} semantic=${h.semanticScore?.toFixed(3) ?? "n/a"} keyword=${h.keywordScore.toFixed(3)}`);
    console.log(`       in-journal text matching tokens: ${[...tokenize(question)].filter((t) => h.text.toLowerCase().includes(t)).join(", ") || "semantic only"}`);
  }

  console.log(hr());
  const llm = await llmAvailable();
  if (llm) {
    console.log(`\n  Answer from local ${llmModelName()}:\n`);
    const answer = await generateAnswer(question, hits);
    console.log(`  ${answer.replace(/\n/g, "\n  ")}`);
  } else {
    console.log(
      "\n  [no local LLM configured — run: export WANDERLOG_OLLAMA_MODEL=gemma3:4b && ollama pull gemma3:4b]\n" +
      "  Ranked evidence answers the question on its own. The top hit is the last kingfisher:\n"
    );
    const topHits = hits.slice(0, 3);
    for (const h of topHits) {
      console.log(`   * ${h.date} ${h.kind} #${h.id} — ${h.text}`);
    }
  }
  console.log(hr());

  const o = overview(db);
  console.log(
    `\n  journal: ${o.sightingCount} sightings (${Object.entries(o.categoryCounts)
      .map(([c, n]) => `${c}=${n}`)
      .join(", ")}) · ${o.walkCount} walks · last activity ${o.lastActivity?.slice(0, 10)}`
  );
  console.log(
    "\n  How this stays offline: embeddings run in-process (Transformers.js, ONNX), SQLite is local," +
    "\n  and the optional Q&A model speaks to Ollama on 127.0.0.1. No cloud, no keys, no telemetry."
  );
  console.log(hr());

  db.close();
}

void main();