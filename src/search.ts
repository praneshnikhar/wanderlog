import type { Db } from "./db.js";
import {
  listSightings,
  listWalks,
  getEmbedding,
  upsertEmbedding,
  getSighting,
  getWalk,
} from "./db.js";
import { embedTexts, cosine, tokenize, keywordOverlap } from "./embeddings.js";
import { trace } from "./tracing.js";
import type { SearchHit, Sighting, Walk } from "./types.js";

export interface SearchOptions {
  since?: string;
  before?: string;
  category?: string;
}

export function sightingText(s: Sighting): string {
  const parts = [
    `${s.category} ${s.species}`,
    s.location ? `at ${s.location}` : null,
    s.weather ? `weather: ${s.weather}` : null,
    s.notes || null,
  ].filter(Boolean);
  return `${parts.join(", ")}. Spotted on ${s.observedAt.slice(0, 10)}.`;
}

export function walkText(w: Walk): string {
  const parts = [
    `a walk${w.trail ? ` on ${w.trail}` : ""}`,
    w.distanceKm != null ? `${w.distanceKm} km` : null,
    w.durationMin != null ? `${w.durationMin} minutes` : null,
    w.notes || null,
  ].filter(Boolean);
  return `${parts.join(", ")}. Walked on ${w.date}.`;
}

interface Doc {
  kind: "sighting" | "walk";
  id: number;
  date: string;
  text: string;
  source: Sighting | Walk;
}

async function docVectors(db: Db, docs: Doc[]): Promise<Float32Array[]> {
  const vectors: (Float32Array | null)[] = docs.map((d) => getEmbedding(db, d.kind, d.id));
  const missing: number[] = [];
  for (let i = 0; i < docs.length; i++) {
    if (!vectors[i]) missing.push(i);
  }
  if (missing.length > 0) {
    const computed = await embedTexts(missing.map((i) => docs[i].text));
    if (computed) {
      for (let j = 0; j < missing.length; j++) {
        const i = missing[j];
        vectors[i] = computed[j];
        upsertEmbedding(db, docs[i].kind, docs[i].id, "local-dynamic", computed[j]);
      }
    }
  }
  return vectors as Float32Array[];
}

function loadDocs(db: Db, opts: SearchOptions = {}): Doc[] {
  const sightings = listSightings(db);
  const walks = listWalks(db);
  const docs: Doc[] = [];
  const inRange = (date: string): boolean => {
    if (opts.since && date < opts.since) return false;
    if (opts.before && date > opts.before) return false;
    return true;
  };
  for (const s of sightings) {
    if (opts.category && s.category !== opts.category) continue;
    const date = s.observedAt.slice(0, 10);
    if (!inRange(date)) continue;
    docs.push({ kind: "sighting", id: s.id, date, text: sightingText(s), source: s });
  }
  for (const w of walks) {
    if (!inRange(w.date)) continue;
    docs.push({ kind: "walk", id: w.id, date: w.date, text: walkText(w), source: w });
  }
  return docs;
}

export async function hybridSearch(db: Db, query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
  return trace(
    {
      name: "search journal",
      op: "function",
      attributes: {
        "wanderlog.query": query.slice(0, 120),
        "wanderlog.filter.category": opts.category ?? "",
        "wanderlog.filter.since": opts.since ?? "",
        "wanderlog.filter.before": opts.before ?? "",
      },
    },
    async (t) => {
      const docs = loadDocs(db, opts);
      if (docs.length === 0) {
        t.setAttribute("wanderlog.hits", 0);
        return [];
      }

      const queryTokens = tokenize(query);
      const vectors = await docVectors(db, docs);
      const queryVec = (await embedTexts([query]))?.[0] ?? null;

      const scored = docs.map((doc, i) => {
        const vec = vectors[i];
        const semantic = queryVec && vec ? Math.max(0, cosine(queryVec, vec)) : null;
        const keyword = keywordOverlap(queryTokens, tokenize(doc.text));
        const ageDays = (Date.now() - new Date(`${doc.date}T00:00:00`).getTime()) / 86_400_000;
        const recency = 1 + 0.12 * Math.exp(-Math.max(0, ageDays) / 21);
        const score = (semantic != null ? 0.75 * semantic + 0.25 * keyword : keyword) * recency;
        const source = doc.source;
        return {
          kind: doc.kind,
          id: doc.id,
          date: doc.date,
          score,
          semanticScore: semantic,
          keywordScore: keyword,
          species: doc.kind === "sighting" ? (source as Sighting).species : undefined,
          location: doc.kind === "sighting" ? (source as Sighting).location : undefined,
          trail: doc.kind === "walk" ? (source as Walk).trail : undefined,
          text: doc.text,
        };
      });

      t.setAttributes({
        "wanderlog.hits": scored.length,
        "wanderlog.semantic_rerank": queryVec != null,
      });
      return scored.sort((a, b) => {
        const bucketA = Math.floor(a.score * 20);
        const bucketB = Math.floor(b.score * 20);
        if (bucketA !== bucketB) return b.score - a.score;
        return b.date.localeCompare(a.date);
      });
    }
  );
}

export async function ensureEmbeddedFor(db: Db, kind: "sighting" | "walk", id: number): Promise<void> {
  const existing = getEmbedding(db, kind, id);
  if (existing) return;
  const entry =
    kind === "sighting" ? (getSighting(db, id) as Sighting | null) : (getWalk(db, id) as Walk | null);
  if (!entry) throw new Error(`${kind} ${id} not found`);
  const text = kind === "sighting" ? sightingText(entry as Sighting) : walkText(entry as Walk);
  const computed = await embedTexts([text]);
  if (computed) {
    upsertEmbedding(db, kind, id, "local-entry", computed[0]);
  }
}