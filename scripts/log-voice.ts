import { openDb } from "../src/db.js";
import { transcribeAudio, logVoiceNote, type Transcription } from "../src/voice.js";
import { sightingText, walkText } from "../src/search.js";
import { llmModelName } from "../src/llm.js";
import { flushTracing, initTracing } from "../src/tracing.js";

const args = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function usage(): never {
  console.error(
    `wanderlog: log from a voice memo

Usage:
  npm run log-voice -- <audio file> [--date YYYY-MM-DD]
  npm run log-voice -- --transcript "<text>" [--date YYYY-MM-DD]

The audio is transcribed with ElevenLabs Scribe when ELEVENLABS_API_KEY is
set (zero-retention by default); pass --transcript to skip the network
entirely. Extraction always runs on your local open-weight model, so set
WANDERLOG_OLLAMA_MODEL=gemma3:4b first, e.g.:

  WANDERLOG_OLLAMA_MODEL=gemma3:4b npm run log-voice -- ~/walk.m4a

Examples:
  npm run log-voice -- ~/walk.m4a
  npm run log-voice -- --transcript "saw a white-breasted kingfisher at the lake jetty, dove twice and got a fish. Walk was 3.2 km, 50 minutes, fog on the lake."`
  );
  process.exit(1);
}

async function main(): Promise<void> {
  await initTracing();

  const transcriptFlag = flag("--transcript");
  const date = flag("--date");
  const positional = args.filter(
    (a, i) => !a.startsWith("--") && args[i - 1] !== "--transcript" && args[i - 1] !== "--date"
  );
  const audioPath = positional[0];

  if (!audioPath && !transcriptFlag) usage();

  const db = openDb();
  let transcription: Transcription | null = null;
  let transcript = transcriptFlag?.trim() ?? "";

  if (!transcript && audioPath) {
    console.log(`transcribing ${audioPath} with ElevenLabs...`);
    transcription = await transcribeAudio(audioPath);
    transcript = transcription.text;
    console.log(`transcript (${transcription.model}${transcription.language ? `, ${transcription.language}` : ""}):`);
  } else {
    console.log("transcript (provided; nothing sent to a server):");
  }
  console.log(`  "${transcript}"\n`);

  const result = await logVoiceNote(db, transcript, { date, transcription });
  if (result.walk) {
    console.log(`logged walk #${result.walk.id}`);
    console.log(walkText(result.walk));
  }
  for (const s of result.sightings) {
    console.log(`logged sighting #${s.id}`);
    console.log(sightingText(s));
  }
  if (!result.walk && result.sightings.length === 0) {
    console.log("nothing loggable found in that note.");
  }
  console.log(`\n(parsed on-device with ${llmModelName()})`);

  db.close();
  await flushTracing();
}

main().catch(async (err) => {
  console.error("log-voice failed:", err instanceof Error ? err.message : err);
  await flushTracing();
  process.exit(1);
});
