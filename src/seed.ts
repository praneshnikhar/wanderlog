import { openDb, type Db, insertWalk, insertSighting, embeddingCount } from "./db.js";
import { embedTexts, modelName } from "./embeddings.js";
import { sightingText, walkText, ensureEmbeddedFor } from "./search.js";
import { upsertEmbedding } from "./db.js";
import type { Category } from "./types.js";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function at(date: string, hour: number, minute = 0): string {
  return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

interface SeedSighting {
  species: string;
  category: Category;
  location: string;
  weather: string;
  notes: string;
  daysAgo: number;
  hour: number;
  walkIndex: number | null;
}

const SEED_WALKS = [
  { daysAgo: 9, trail: "Central Park, Jaipur", distanceKm: 3.2, durationMin: 48, notes: "First cool morning after the monsoon. Fog sitting on the lake. Wore the long-sleeve for the first time in months." },
  { daysAgo: 6, trail: "Nahargarh Fort trail", distanceKm: 5.8, durationMin: 95, notes: "Sharp climb, then views over the whole city. Chai at the top, boiled eggs wrapped in newspaper." },
  { daysAgo: 4, trail: "Ram Niwas Garden loop", distanceKm: 1.6, durationMin: 25, notes: "Quick evening loop while the light held. Jackals audible from the far side." },
  { daysAgo: 3, trail: "Maota Lake, Amber", distanceKm: 2.4, durationMin: 55, notes: "Ducked in before sunset. Water levels are back up after the rains — fish actually jumping." },
] as const;

const SEED_SIGHTINGS: SeedSighting[] = [
  {
    species: "white-breasted kingfisher",
    category: "bird",
    location: "Central Park lake jetty",
    weather: "misty, 24C",
    notes: "Perched on the jetty rail, dove twice, came up with a fish the second time. First kingfisher of the season.",
    daysAgo: 9,
    hour: 7,
    walkIndex: 0,
  },
  {
    species: "rose-ringed parakeet",
    category: "bird",
    location: "Central Park, near the banyan",
    weather: "misty, 24C",
    notes: "A screeching flock of maybe 40, all heading west. Felt like autumn has finally started.",
    daysAgo: 9,
    hour: 7,
    walkIndex: 0,
  },
  {
    species: "Indian peafowl",
    category: "bird",
    location: "Central Park, scrub edge",
    weather: "misty, 24C",
    notes: "Heard the call first — that an-ga! — then found one male fanning in the fog. Eventually worked out why every walk is a bird walk here.",
    daysAgo: 9,
    hour: 8,
    walkIndex: 0,
  },
  {
    species: "Indian gray mongoose",
    category: "animal",
    location: "Nahargarh trail, halfway switchback",
    weather: "sunny, 27C",
    notes: "Crossed the path two metres ahead, then stopped to watch me watch it. Stalked off into the scrub.",
    daysAgo: 6,
    hour: 9,
    walkIndex: 1,
  },
  {
    species: "rufous treepie",
    category: "bird",
    location: "Nahargarh trail, ridge top",
    weather: "sunny, 27C",
    notes: "Chatty pair escorting me along the ridge. Later identified from the call — a long khich-khich-khich.",
    daysAgo: 6,
    hour: 10,
    walkIndex: 1,
  },
  {
    species: "peepal fig",
    category: "plant",
    location: "Nahargarh trail, near the fort gate",
    weather: "sunny, 27C",
    notes: "Fruiting heavily — figs everywhere and the treepies were working the crown. Everything eats figs this time of year.",
    daysAgo: 6,
    hour: 10,
    walkIndex: 1,
  },
  {
    species: "black kite",
    category: "bird",
    location: "Nahargarh fort ramparts",
    weather: "sunny, 27C",
    notes: "Three kites riding thermals below the ramparts. One swooped low enough to see individual feathers.",
    daysAgo: 6,
    hour: 11,
    walkIndex: 1,
  },
  {
    species: "rain lily",
    category: "plant",
    location: "Ram Niwas Garden, west lawn",
    weather: "clear, 29C",
    notes: "A whole patch blooming within days of the last rain. Ephemerals — gone by next week.",
    daysAgo: 4,
    hour: 18,
    walkIndex: 2,
  },
  {
    species: "plain tiger butterfly",
    category: "insect",
    location: "Ram Niwas Garden, hedgerow",
    weather: "clear, 29C",
    notes: "Settled long enough to count the eyelike spots on the upper wing. Purplish sheen in evening light.",
    daysAgo: 4,
    hour: 18,
    walkIndex: 2,
  },
  {
    species: "white-breasted kingfisher",
    category: "bird",
    location: "Maota Lake, Amber",
    weather: "clear, 28C, golden hour",
    notes: "Same blue flash as September — perched on a post at the lake edge, still wet from a dive. This is the place for them.",
    daysAgo: 3,
    hour: 17,
    walkIndex: 3,
  },
  {
    species: "blue rock pigeon",
    category: "bird",
    location: "Maota Lake boathouse",
    weather: "clear, 28C",
    notes: "Bathing in the shallows. A kid and his grandfather feeding them — the grandpa pointing out the kingfisher too.",
    daysAgo: 3,
    hour: 18,
    walkIndex: 3,
  },
  {
    species: "monitor lizard",
    category: "animal",
    location: "Maota Lake, south bank",
    weather: "clear, 28C",
    notes: "A big one sunning on a rock, then sliding into the water with a hiss. By far the longest animal I saw today.",
    daysAgo: 3,
    hour: 18,
    walkIndex: 3,
  },
];

export async function seedWalk(db: Db, w: (typeof SEED_WALKS)[number]): Promise<number> {
  const walk = insertWalk(db, {
    date: daysAgo(w.daysAgo),
    trail: w.trail,
    distanceKm: w.distanceKm,
    durationMin: w.durationMin,
    notes: w.notes,
  });
  await ensureEmbeddedFor(db, "walk", walk.id);
  return walk.id;
}

export async function seed(db: Db, opts: { force?: boolean } = {}): Promise<{ inserted: boolean; walks: number; sightings: number; embedded: number }> {
  const existing = (db.prepare("SELECT COUNT(*) AS n FROM sightings").get() as { n: number }).n;
  const existingWalks = (db.prepare("SELECT COUNT(*) AS n FROM walks").get() as { n: number }).n;
  if (!opts.force && (existing > 0 || existingWalks > 0)) {
    return { inserted: false, walks: existingWalks, sightings: existing, embedded: embeddingCount(db) };
  }

  const walkIds: number[] = [];
  for (const w of SEED_WALKS) {
    walkIds.push(await seedWalk(db, w));
  }

  const sightings = SEED_SIGHTINGS.map((s) =>
    insertSighting(db, {
      species: s.species,
      category: s.category,
      location: s.location,
      weather: s.weather,
      notes: s.notes,
      observedAt: at(daysAgo(s.daysAgo), s.hour),
      walkId: s.walkIndex != null ? walkIds[s.walkIndex] : undefined,
    })
  );

  let embedded = 0;
  try {
    const texts = sightings.map(sightingText);
    const vectors = await embedTexts(texts);
    if (vectors) {
      for (let i = 0; i < sightings.length; i++) {
        upsertEmbedding(db, "sighting", sightings[i].id, modelName(), vectors[i]);
        embedded++;
      }
    } else {
      console.error("[wanderlog] (seed) embedding model unavailable — seeded without vectors; search will use keywords only");
    }
  } catch (err) {
    console.error(`[wanderlog] (seed) embeddings failed: ${(err as Error).message} — seeded without vectors`);
  }

  return { inserted: true, walks: walkIds.length, sightings: sightings.length, embedded };
}

async function main(): Promise<void> {
  const db = openDb();
  const result = await seed(db, { force: process.argv.includes("--force") });
  console.log(
    result.inserted
      ? `Seeded a demo field journal: ${result.sightings} sightings across ${result.walks} walks (${result.embedded} embedded with ${modelName()}).`
      : `Journal already has data (${result.sightings} sightings, ${result.walks} walks) — nothing inserted. Use --force to reseed.`
  );
  console.log('Try: "where did I see the kingfisher last time?"');
  db.close();
}

if (process.argv[1]?.endsWith("seed.ts") || process.argv[1]?.endsWith("seed.js")) {
  void main();
}