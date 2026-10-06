import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { DB_PATH } from "./config.js";
import type { Category, Walk, Sighting, Overview } from "./types.js";

export type Db = Database.Database;

export function openDb(dbPath: string = DB_PATH): Db {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS walks (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      date         TEXT NOT NULL,
      trail        TEXT,
      distance_km  REAL,
      duration_min INTEGER,
      notes        TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sightings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      species     TEXT NOT NULL,
      category    TEXT NOT NULL,
      location    TEXT,
      lat         REAL,
      lon         REAL,
      weather     TEXT,
      notes       TEXT,
      observed_at TEXT NOT NULL,
      walk_id     INTEGER REFERENCES walks(id) ON DELETE SET NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS embeddings (
      entity_type TEXT NOT NULL,
      entity_id   INTEGER NOT NULL,
      model       TEXT NOT NULL,
      dim         INTEGER NOT NULL,
      vector      BLOB NOT NULL,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (entity_type, entity_id)
    );

    CREATE INDEX IF NOT EXISTS idx_sightings_observed_at ON sightings(observed_at);
    CREATE INDEX IF NOT EXISTS idx_sightings_category ON sightings(category);
  `);
}

export function insertWalk(db: Db, input: { date?: string; trail?: string; distanceKm?: number; durationMin?: number; notes?: string }): Walk {
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  const id = db
    .prepare("INSERT INTO walks (date, trail, distance_km, duration_min, notes) VALUES (?, ?, ?, ?, ?)")
    .run(date, input.trail ?? null, input.distanceKm ?? null, input.durationMin ?? null, input.notes ?? null)
    .lastInsertRowid as number;
  return getWalk(db, id)!;
}

export function insertSighting(
  db: Db,
  input: {
    species: string;
    category: Category;
    location?: string;
    lat?: number;
    lon?: number;
    weather?: string;
    notes?: string;
    observedAt?: string;
    walkId?: number;
  }
): Sighting {
  const observedAt = input.observedAt ?? new Date().toISOString();
  const id = db
    .prepare(
      `INSERT INTO sightings (species, category, location, lat, lon, weather, notes, observed_at, walk_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.species.trim(),
      input.category,
      input.location ?? null,
      input.lat ?? null,
      input.lon ?? null,
      input.weather ?? null,
      input.notes ?? null,
      observedAt,
      input.walkId ?? null
    ).lastInsertRowid as number;
  return getSighting(db, id)!;
}

export function getWalk(db: Db, id: number): Walk | null {
  const row = db.prepare("SELECT * FROM walks WHERE id = ?").get(id) as WalkRow | undefined;
  return row ? mapWalk(row) : null;
}

export function getSighting(db: Db, id: number): Sighting | null {
  const row = db.prepare("SELECT * FROM sightings WHERE id = ?").get(id) as SightingRow | undefined;
  return row ? mapSighting(row) : null;
}

interface SightingRow {
  id: number;
  species: string;
  category: string;
  location: string | null;
  lat: number | null;
  lon: number | null;
  weather: string | null;
  notes: string | null;
  observed_at: string;
  walk_id: number | null;
  created_at: string;
}

interface WalkRow {
  id: number;
  date: string;
  trail: string | null;
  distance_km: number | null;
  duration_min: number | null;
  notes: string | null;
  created_at: string;
}

function mapSighting(r: SightingRow): Sighting {
  return {
    id: r.id,
    species: r.species,
    category: r.category as Category,
    location: r.location ?? undefined,
    lat: r.lat ?? undefined,
    lon: r.lon ?? undefined,
    weather: r.weather ?? undefined,
    notes: r.notes ?? undefined,
    observedAt: r.observed_at,
    walkId: r.walk_id ?? undefined,
    createdAt: r.created_at,
  };
}

function mapWalk(r: WalkRow): Walk {
  return {
    id: r.id,
    date: r.date,
    trail: r.trail ?? undefined,
    distanceKm: r.distance_km ?? undefined,
    durationMin: r.duration_min ?? undefined,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
  };
}

export function listSightings(db: Db): Sighting[] {
  const rows = db.prepare("SELECT * FROM sightings ORDER BY observed_at DESC").all() as SightingRow[];
  return rows.map(mapSighting);
}

export function listWalks(db: Db): Walk[] {
  const rows = db.prepare("SELECT * FROM walks ORDER BY date DESC").all() as WalkRow[];
  return rows.map(mapWalk);
}

export function walkEntriesForDate(db: Db, date: string): Walk[] {
  const rows = db.prepare("SELECT * FROM walks WHERE date = ? ORDER BY created_at").all(date) as WalkRow[];
  return rows.map(mapWalk);
}

export function sightingsForDate(db: Db, date: string): Sighting[] {
  const rows = db
    .prepare("SELECT * FROM sightings WHERE substr(observed_at, 1, 10) = ? ORDER BY observed_at")
    .all(date) as SightingRow[];
  return rows.map(mapSighting);
}

export function sightingsForCategory(db: Db, category: string): Sighting[] {
  const rows = db.prepare("SELECT * FROM sightings WHERE category = ? ORDER BY observed_at DESC").all(category) as SightingRow[];
  return rows.map(mapSighting);
}

export function sightingsForWalk(db: Db, walkId: number): Sighting[] {
  const rows = db.prepare("SELECT * FROM sightings WHERE walk_id = ? ORDER BY observed_at").all(walkId) as SightingRow[];
  return rows.map(mapSighting);
}

export function overview(db: Db): Overview {
  const sightingCount = (db.prepare("SELECT COUNT(*) AS n FROM sightings").get() as { n: number }).n;
  const walkCount = (db.prepare("SELECT COUNT(*) AS n FROM walks").get() as { n: number }).n;
  const catRows = db.prepare("SELECT category, COUNT(*) AS n FROM sightings GROUP BY category").all() as {
    category: string;
    n: number;
  }[];
  const last = db
    .prepare(
      "SELECT MAX(m) AS m FROM (SELECT MAX(observed_at) AS m FROM sightings UNION ALL SELECT MAX(date || 'T23:59:59') AS m FROM walks)"
    )
    .get() as { m: string | null };
  return {
    sightingCount,
    walkCount,
    categoryCounts: Object.fromEntries(catRows.map((r) => [r.category, r.n])),
    lastActivity: last.m ?? null,
  };
}

export function upsertEmbedding(
  db: Db,
  entityType: string,
  entityId: number,
  model: string,
  vector: Float32Array
): void {
  db.prepare(
    `INSERT INTO embeddings (entity_type, entity_id, model, dim, vector)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(entity_type, entity_id) DO UPDATE SET
       model = excluded.model,
       dim = excluded.dim,
       vector = excluded.vector,
       updated_at = datetime('now')`
  ).run(entityType, entityId, model, vector.length, Buffer.from(vector.buffer));
}

export function getEmbedding(db: Db, entityType: string, entityId: number): Float32Array | null {
  const row = db
    .prepare("SELECT vector, dim FROM embeddings WHERE entity_type = ? AND entity_id = ?")
    .get(entityType, entityId) as { vector: Buffer; dim: number } | undefined;
  if (!row) return null;
  return new Float32Array(row.vector.buffer, row.vector.byteOffset, row.dim);
}

export function embeddingCount(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM embeddings").get() as { n: number }).n;
}