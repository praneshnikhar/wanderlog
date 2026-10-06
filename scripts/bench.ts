import { openDb } from "../src/db.js";
import { seed } from "../src/seed.js";
import { embedTexts, modelName } from "../src/embeddings.js";
import { hybridSearch, sightingText } from "../src/search.js";
import { listSightings } from "../src/db.js";
import { llmAvailable, generateAnswer, llmModelName } from "../src/llm.js";

function ms(start: [number, number]): number {
  const [s, ns] = process.hrtime(start);
  return Math.round(s * 1000 + ns / 1e6);
}

async function main(): Promise<void> {
  console.log(`model            : ${modelName()}`);

  let t = process.hrtime();
  await embedTexts(["warmup: load the model into this process"]);
  console.log(`cold model load  : ${ms(t)} ms (first call in a fresh process)`);

  const db = openDb(process.env.WANDERLOG_DB ?? ":memory:");
  await seed(db, {});
  const sightings = listSightings(db);
  const texts = sightings.map(sightingText);

  console.log(`journal entries  : ${sightings.length} sightings`);

  t = process.hrtime();
  await embedTexts(texts);
  console.log(`embed ${texts.length} entries  : ${ms(t)} ms total`);

  t = process.hrtime();
  await embedTexts([texts[0]]);
  console.log(`single embed     : ${ms(t)} ms (warm)`);

  t = process.hrtime();
  await embedTexts(["where did I see the kingfisher last time?"]);
  console.log(`query embed      : ${ms(t)} ms`);

  t = process.hrtime();
  const hits = await hybridSearch(db, "where did I see the kingfisher last time?");
  console.log(`full search      : ${ms(t)} ms (query + scoring + ranking)`);
  console.log(`top hit          : [${hits[0].date}] ${hits[0].species} at ${hits[0].location}`);

  const llm = await llmAvailable();
  console.log(`local Q&A model  : ${llm ? llmModelName() : "not configured"}`);
  if (llm) {
    t = process.hrtime();
    const answer = await generateAnswer("where did I see the kingfisher last time?", hits);
    console.log(`LLM answer       : ${ms(t)} ms`);
    console.log(`answer           : ${answer.split("\n")[0]}`);
  }
  db.close();
}

void main();