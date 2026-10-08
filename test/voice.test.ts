import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.WANDERLOG_OLLAMA_MODEL = "stub-model";
process.env.WANDERLOG_OLLAMA_HOST = "http://ollama.test";
process.env.ELEVENLABS_API_KEY = "test-key";
process.env.WANDERLOG_EMBED_MODEL = "test/does-not-exist";
delete process.env.WANDERLOG_OFFLINE;

interface RecordedCall {
  url: string;
  init?: RequestInit;
}

const calls: RecordedCall[] = [];
let zrmDenied = false;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  calls.push({ url, init });
  if (url.includes("/api/tags")) {
    return json({ models: [{ name: "stub-model:latest" }] });
  }
  if (url.includes("/api/chat")) {
    return json({
      message: {
        content: JSON.stringify({
          walk: {
            trail: "Central Park loop",
            distance_km: "3.2",
            duration_min: 50,
            notes: "fog on the lake",
          },
          sightings: [
            {
              species: "white-breasted kingfisher",
              category: "bird",
              location: "Central Park lake jetty",
              notes: "dove twice, got a fish",
            },
            {
              species: "rain lily",
              category: "mystery",
              location: "pathside",
              notes: "fresh after last night's rain",
            },
          ],
        }),
      },
      prompt_eval_count: 210,
      eval_count: 64,
    });
  }
  if (url.includes("api.elevenlabs.io")) {
    if (zrmDenied && url.includes("enable_logging=false")) {
      return new Response(
        JSON.stringify({
          detail: {
            type: "authorization_error",
            code: "forbidden",
            message: "Only users from the enterprise or trial tier can use ZRM mode.",
          },
        }),
        { status: 403, headers: { "content-type": "application/json" } }
      );
    }
    return json({
      text: "saw a kingfisher at the jetty and walked three point two kilometers",
      language_code: "en",
    });
  }
  throw new Error(`unexpected network call in test: ${url}`);
}) as typeof fetch;

const { parseVoiceNoteJson, transcribeAudio, logVoiceNote } = await import("../src/voice.js");
const { openDb, listSightings, listWalks } = await import("../src/db.js");

function section(name: string): void {
  console.log(`  ✓ ${name}`);
}

console.log("WanderLog voice test");

const parsed = parseVoiceNoteJson(
  'Here you go: {"walk": null, "sightings": [{"species": "robin", "category": "alien", "notes": "on the fence"}]} all done'
);
assert.equal(parsed.sightings.length, 1);
assert.equal(parsed.sightings[0].category, "other", "unknown category falls back to 'other'");
assert.equal(parsed.walk, null);
section("parseVoiceNoteJson tolerates prose around JSON + category fallback");

assert.throws(() => parseVoiceNoteJson("no json here"), /did not return JSON/);
section("parseVoiceNoteJson rejects non-JSON");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wanderlog-voice-"));
const audioPath = path.join(tmpDir, "memo.m4a");
fs.writeFileSync(audioPath, Buffer.from("fake audio bytes"));

const transcription = await transcribeAudio(audioPath);
assert.match(transcription.text, /kingfisher/);
assert.equal(transcription.model, "scribe_v2");

const elCall = calls.find((c) => c.url.includes("api.elevenlabs.io"));
assert.ok(elCall, "ElevenLabs was called");
assert.match(elCall.url, /\/v1\/speech-to-text/);
assert.match(elCall.url, /enable_logging=false/, "zero-retention by default");
const headers = elCall.init?.headers as Record<string, string>;
assert.equal(headers["xi-api-key"], "test-key");
const form = elCall.init?.body as FormData;
assert.equal(form.get("model_id"), "scribe_v2");
assert.ok(form.get("file"), "audio file is attached");
section("transcribeAudio posts zero-retention multipart to ElevenLabs");

zrmDenied = true;
await assert.rejects(transcribeAudio(audioPath), /WANDERLOG_STT_LOGGING=1/);
zrmDenied = false;
section("transcribeAudio explains the zero-retention plan limit instead of dumping HTTP 403");

const db = openDb(":memory:");
const result = await logVoiceNote(db, "I saw things and walked");
assert.equal(result.sightings.length, 2);
assert.equal(result.walk?.trail, "Central Park loop");
assert.equal(result.walk?.distanceKm, 3.2, "distance is coerced to a number");
assert.equal(result.walk?.durationMin, 50);
assert.equal(result.sightings[0].category, "bird");
assert.equal(result.sightings[1].category, "other");
assert.equal(result.sightings[0].walkId, result.walk?.id, "sightings are linked to the walk");

const chatCall = calls.find((c) => c.url.includes("/api/chat"));
const chatBody = JSON.parse(String(chatCall?.init?.body)) as { format?: string; stream?: boolean };
assert.equal(chatBody.format, "json");
assert.equal(chatBody.stream, false);

assert.equal(listWalks(db).length, 1, "walk persisted");
assert.equal(listSightings(db).length, 2, "sightings persisted");
section("logVoiceNote structures a transcript into walk + sightings locally");

db.close();
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log("\nvoice tests passed");
