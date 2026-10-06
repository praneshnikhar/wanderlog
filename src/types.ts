export const CATEGORIES = ["bird", "plant", "animal", "insect", "fungi", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface SightingInput {
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

export interface Sighting extends SightingInput {
  id: number;
  observedAt: string;
  createdAt: string;
}

export interface WalkInput {
  date?: string;
  trail?: string;
  distanceKm?: number;
  durationMin?: number;
  notes?: string;
}

export interface Walk extends WalkInput {
  id: number;
  date: string;
  createdAt: string;
}

export type JournalEntryKind = "sighting" | "walk";

export interface JournalEntry {
  kind: JournalEntryKind;
  id: number;
  date: string;
  text: string;
}

export interface SearchHit {
  kind: JournalEntryKind;
  id: number;
  date: string;
  score: number;
  semanticScore: number | null;
  keywordScore: number;
  species?: string;
  location?: string;
  trail?: string;
  text: string;
}

export interface Overview {
  sightingCount: number;
  walkCount: number;
  categoryCounts: Record<string, number>;
  lastActivity: string | null;
}