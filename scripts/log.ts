import { openDb, insertSighting, insertWalk } from "../src/db.js";
import { ensureEmbeddedFor, sightingText, walkText } from "../src/search.js";
import { CATEGORIES, type Category } from "../src/types.js";

const args = process.argv.slice(2);

function usage(): never {
  console.error(
    `wanderlog: one-line field logger

Usage:
  npm run log -- <species> <category> [location] [notes...]
  npm run log-walk -- <trail> [distance_km] [notes...]

Examples:
  npm run log -- "white-breasted kingfisher" bird "Maota Lake jetty" "dove twice, got a fish"
  npm run log-walk -- "Central Park loop" 3.2 "fog on the lake, first kingfisher of the season"

Categories: ${CATEGORIES.join(", ")}`
  );
  process.exit(1);
}

if (args.length === 0 || args[0] === "-h" || args[0] === "--help") usage();

const [command, ...rest] = args;
const db = openDb();

async function main(): Promise<void> {
  if (command === "log") {
    const [species, category, location, ...notes] = rest;
    if (!species || !category) usage();
    if (!(CATEGORIES as readonly string[]).includes(category)) usage();
    const sighting = insertSighting(db, {
      species,
      category: category as Category,
      location: location || undefined,
      notes: notes.join(" ") || undefined,
    });
    await ensureEmbeddedFor(db, "sighting", sighting.id);
    console.log(`logged sighting #${sighting.id}`);
    console.log(sightingText(sighting));
  } else if (command === "log-walk") {
    const [trail, distanceKm, ...notes] = rest;
    if (!trail) usage();
    const walk = insertWalk(db, {
      trail,
      distanceKm: distanceKm ? Number(distanceKm) : undefined,
      notes: notes.join(" ") || undefined,
    });
    await ensureEmbeddedFor(db, "walk", walk.id);
    console.log(`logged walk #${walk.id}`);
    console.log(walkText(walk));
  } else {
    console.error(`unknown command: ${command}`);
    usage();
  }
  db.close();
}

void main();