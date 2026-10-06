import type { McpServer, RegisteredResource, RegisteredResourceTemplate } from "@modelcontextprotocol/server";
import { ResourceTemplate } from "@modelcontextprotocol/server";
import type { Db } from "./db.js";
import { openDb, overview, sightingsForCategory, sightingsForDate, walkEntriesForDate, getWalk, sightingsForWalk } from "./db.js";
import { sightingText, walkText } from "./search.js";
import { CATEGORIES } from "./types.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function first(params: Record<string, string | string[]>, key: string): string {
  const v = params[key];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function jsonContents(uri: string, value: unknown) {
  return {
    contents: [{ uri, mimeType: "application/json", text: JSON.stringify(value, null, 2) }],
  };
}

export function registerResources(server: McpServer, db: Db): void {
  server.registerResource(
    "journal-stats",
    "journal://stats",
    {
      title: "WanderLog journal statistics",
      description: "Counts of sightings by category, walk count, and last activity date",
      mimeType: "application/json",
    },
    (uri) => jsonContents(String(uri), overview(db))
  );

  server.registerResource(
    "journal-day",
    new ResourceTemplate("journal://day/{date}", { list: undefined }),
    {
      title: "Journal entries for a day",
      description: "Every sighting and walk logged on a given YYYY-MM-DD date",
      mimeType: "application/json",
    },
    (_uri, params) => {
      const date = first(params, "date");
      if (!DATE_RE.test(date)) {
        return jsonContents(`journal://day/${date}`, { error: `invalid date "${date}", expected YYYY-MM-DD` });
      }
      const walks = walkEntriesForDate(db, date).map((w) => ({ kind: "walk" as const, ...w, text: walkText(w) }));
      const sightings = sightingsForDate(db, date).map((s) => ({ kind: "sighting" as const, ...s, text: sightingText(s) }));
      return jsonContents(`journal://day/${date}`, { date, walks, sightings, count: walks.length + sightings.length });
    }
  );

  server.registerResource(
    "journal-category",
    new ResourceTemplate("journal://category/{category}", { list: undefined }),
    {
      title: "Sightings in a category",
      description: `All sightings in one category: ${CATEGORIES.join(", ")}`,
      mimeType: "application/json",
    },
    (_uri, params) => {
      const category = first(params, "category");
      if (!(CATEGORIES as readonly string[]).includes(category)) {
        return jsonContents(`journal://category/${category}`, {
          error: `unknown category "${category}", expected one of ${CATEGORIES.join(", ")}`,
        });
      }
      const sightings = sightingsForCategory(db, category).map((s) => ({ kind: "sighting" as const, ...s, text: sightingText(s) }));
      return jsonContents(`journal://category/${category}`, { category, count: sightings.length, sightings });
    }
  );

  server.registerResource(
    "journal-walk",
    new ResourceTemplate("journal://walk/{id}", { list: undefined }),
    {
      title: "A walk with its sightings",
      description: "A logged walk and every sighting recorded during it",
      mimeType: "application/json",
    },
    (_uri, params) => {
      const id = Number(first(params, "id"));
      const walk = getWalk(db, id);
      if (!walk || Number.isNaN(id)) {
        return jsonContents(`journal://walk/${first(params, "id")}`, { error: `no walk with id ${first(params, "id")}` });
      }
      const sightings = sightingsForWalk(db, id).map((s) => ({ kind: "sighting" as const, ...s, text: sightingText(s) }));
      return jsonContents(`journal://walk/${id}`, { walk: { ...walk, text: walkText(walk) }, sightings });
    }
  );
}