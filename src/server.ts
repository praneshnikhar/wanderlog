import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod/v4";
import { openDb, type Db } from "./db.js";
import { insertSighting, insertWalk, overview } from "./db.js";
import { hybridSearch, ensureEmbeddedFor, sightingText, walkText } from "./search.js";
import { registerResources } from "./resources.js";
import { llmAvailable, generateAnswer, llmModelName } from "./llm.js";
import { transcribeAudio, logVoiceNote } from "./voice.js";
import { initTracing, trace } from "./tracing.js";
import { CATEGORIES } from "./types.js";

function traceTool(name: string, args: unknown): Parameters<typeof trace>[0] {
  return {
    name: `execute_tool ${name}`,
    op: "gen_ai.execute_tool",
    attributes: {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": name,
      "gen_ai.tool.call.arguments": JSON.stringify(args).slice(0, 500),
    },
    flush: true,
  };
}

const SERVER_NAME = "wanderlog";
const SERVER_VERSION = "1.0.0";

function text(content: string) {
  return { content: [{ type: "text" as const, text: content }] };
}

function errorText(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export function createServer(db: Db): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  }, {
    capabilities: { tools: {}, resources: {} },
  });

  server.registerTool(
    "log_sighting",
    {
      title: "Log a sighting",
      description:
        "Record a field observation: species, category, where you were, and any notes. " +
        "Everything is stored in a local SQLite journal on this machine — nothing leaves it. " +
        "Use this after walks, runs, or garden sessions to build your field journal.",
      inputSchema: z.object({
        species: z.string().describe("Common name of what you saw, e.g. 'white-breasted kingfisher'"),
        category: z.enum(CATEGORIES).describe("What kind of thing it is"),
        location: z.string().optional().describe("Place name, e.g. 'Central Park, Jaipur'"),
        lat: z.number().optional().describe("Latitude of the sighting"),
        lon: z.number().optional().describe("Longitude of the sighting"),
        weather: z.string().optional().describe("Conditions, e.g. 'misty, 24C'"),
        notes: z.string().optional().describe("Field notes: behavior, plumage, sounds, context"),
        observed_at: z.string().optional().describe("ISO 8601 datetime; defaults to now"),
        walk_id: z.number().optional().describe("Walk id this sighting belongs to, if any"),
      }),
    },
    async (args) => {
      try {
        return await trace(traceTool("log_sighting", args), async (t) => {
          const sighting = insertSighting(db, {
            species: args.species,
            category: args.category,
            location: args.location,
            lat: args.lat,
            lon: args.lon,
            weather: args.weather,
            notes: args.notes,
            observedAt: args.observed_at,
            walkId: args.walk_id,
          });
          await ensureEmbeddedFor(db, "sighting", sighting.id);
          t.setAttribute("wanderlog.sighting_id", sighting.id);
          t.setAttribute("wanderlog.category", sighting.category);
          return text(
            `Logged sighting #${sighting.id}:\n${sightingText(sighting)}\n` +
            `The journal now has ${overview(db).sightingCount} sightings. Ask me "where did I see this before?" anytime — search stays on-device.`
          );
        });
      } catch (err) {
        return errorText(`failed to log sighting: ${(err as Error).message}`);
      }
    }
  );

  server.registerTool(
    "log_walk",
    {
      title: "Log a walk",
      description:
        "Record an outing: trail or route name, distance, duration, and notes. " +
        "Walks group the day's sightings together and are stored only on this machine.",
      inputSchema: z.object({
        date: z.string().optional().describe("YYYY-MM-DD; defaults to today"),
        trail: z.string().optional().describe("Trail, park, or route name"),
        distance_km: z.number().optional().describe("Distance walked in kilometers"),
        duration_min: z.number().optional().describe("Duration in minutes"),
        notes: z.string().optional().describe("Notes about the outing"),
      }),
    },
    async (args) => {
      try {
        return await trace(traceTool("log_walk", args), async (t) => {
          const walk = insertWalk(db, {
            date: args.date,
            trail: args.trail,
            distanceKm: args.distance_km,
            durationMin: args.duration_min,
            notes: args.notes,
          });
          await ensureEmbeddedFor(db, "walk", walk.id);
          t.setAttribute("wanderlog.walk_id", walk.id);
          return text(`Logged walk #${walk.id}:\n${walkText(walk)}`);
        });
      } catch (err) {
        return errorText(`failed to log walk: ${(err as Error).message}`);
      }
    }
  );

  server.registerTool(
    "search_journal",
    {
      title: "Search the field journal",
      description:
        "Semantic + keyword search over past sightings and walks, computed locally with an open-weight " +
        "embedding model. Natural queries work, e.g. 'where did I see the kingfisher last time?' or " +
        "'mushrooms after the rain'. Never sends your journal anywhere.",
      inputSchema: z.object({
        query: z.string().describe("A natural language query or keywords"),
        k: z.number().int().min(1).max(20).optional().describe("Max results (default 5)"),
        since: z.string().optional().describe("Only entries on or after YYYY-MM-DD"),
        before: z.string().optional().describe("Only entries on or before YYYY-MM-DD"),
        category: z.enum(CATEGORIES).optional().describe("Restrict to a category"),
      }),
    },
    async (args) => {
      try {
        return await trace(traceTool("search_journal", args), async (t) => {
          const hits = await hybridSearch(db, args.query, {
            since: args.since,
            before: args.before,
            category: args.category,
          });
          const top = hits.slice(0, args.k ?? 5);
          t.setAttribute("wanderlog.results", top.length);
          if (top.length === 0) {
            return text("No journal entries match. Log some sightings first — then get outside and back.");
          }
          const lines = top.map((h, i) => {
            const where = h.location ? ` at ${h.location}` : h.trail ? ` on ${h.trail}` : "";
            const what = h.species ?? "walk";
            return `${String(i + 1).padStart(2, " ")}. [${h.date}] ${h.kind} #${h.id} — ${what}${where} (score ${h.score.toFixed(3)}${h.semanticScore != null ? `, semantic ${h.semanticScore.toFixed(3)}` : ""})`;
          });
          return text(`Top ${top.length} matches for "${args.query}":\n${lines.join("\n")}`);
        });
      } catch (err) {
        return errorText(`search failed: ${(err as Error).message}`);
      }
    }
  );

  server.registerTool(
    "journal_overview",
    {
      title: "Journal overview",
      description:
        "Summary of the entire field journal: how many sightings and walks, counts by category, " +
        "and the date of your last outing.",
      inputSchema: z.object({}),
    },
    async () => {
      return trace(traceTool("journal_overview", {}), async (t) => {
        const o = overview(db);
        t.setAttributes({
          "wanderlog.sightings": o.sightingCount,
          "wanderlog.walks": o.walkCount,
        });
        const lines = [
          `Sightings: ${o.sightingCount}`,
          `Walks: ${o.walkCount}`,
          `By category: ${Object.entries(o.categoryCounts).map(([c, n]) => `${c} (${n})`).join(", ") || "none yet"}`,
          `Last activity: ${o.lastActivity ?? "never"}`,
        ];
        return text(lines.join("\n"));
      });
    }
  );

  server.registerTool(
    "answer_question",
    {
      title: "Answer a question about your journal",
      description:
        "Ask anything about your past outings. Retrieves the most relevant entries locally, then — when a " +
        "local open-weight model (WANDERLOG_OLLAMA_MODEL, e.g. gemma3 via Ollama) is running — writes the " +
        "answer on-device. Without a local model it returns the ranked best evidence instead. No cloud calls, ever.",
      inputSchema: z.object({
        question: z.string().describe("A question about your sightings and walks"),
      }),
    },
    async (args) => {
      try {
        return await trace(traceTool("answer_question", args), async (t) => {
          const hits = await hybridSearch(db, args.question, {});
          const top = hits.slice(0, 10);
          if (top.length === 0) {
            t.setAttribute("wanderlog.answer_source", "empty");
            return text("Nothing in the journal relates to that question yet. Time to go outside.");
          }
          if (await llmAvailable()) {
            const answer = await generateAnswer(args.question, top);
            t.setAttribute("wanderlog.answer_source", "local-model");
            const evidence = top
              .slice(0, 3)
              .map((h) => `${h.kind} #${h.id} on ${h.date}: ${h.text}`)
              .join("\n");
            return text(
              `Answer (from local ${llmModelName()}):\n\n${answer}\n\n` +
              `Top evidence:\n${evidence}`
            );
          }
          t.setAttribute("wanderlog.answer_source", "evidence-fallback");
          const evidence = top
            .map((h) => `${h.kind} #${h.id} on ${h.date} (score ${h.score.toFixed(3)}): ${h.species ? `${h.species} at ${h.location ?? "?"}` : `walk on ${h.trail ?? "?"}`} — ${h.text}`)
            .join("\n");
          return text(
            `No local model is configured (set WANDERLOG_OLLAMA_MODEL, e.g. gemma3). Best evidence from the journal:\n\n${evidence}`
          );
        });
      } catch (err) {
        return errorText(`could not answer: ${(err as Error).message}`);
      }
    }
  );

  server.registerTool(
    "log_voice_note",
    {
      title: "Log from a voice note",
      description:
        "Turn a voice memo from a walk into journal entries. With ELEVENLABS_API_KEY set, the audio is transcribed " +
        "by ElevenLabs Scribe (zero-retention unless WANDERLOG_STT_LOGGING=1); a local open-weight model " +
        "(WANDERLOG_OLLAMA_MODEL, e.g. gemma3) then extracts sightings and the walk on-device. Pass transcript " +
        "instead of audio_path to skip the network entirely — parsing and storage stay local.",
      inputSchema: z.object({
        audio_path: z.string().optional().describe("Path to a voice memo on this machine (m4a, mp3, wav, ogg, webm)"),
        transcript: z.string().optional().describe("An existing transcript; skips transcription and works fully offline"),
        date: z.string().optional().describe("YYYY-MM-DD date for the walk and sightings; defaults to today"),
      }),
    },
    async (args) => {
      try {
        return await trace(traceTool("log_voice_note", args), async (t) => {
          const provided = args.transcript?.trim();
          if (!args.audio_path && !provided) {
            return errorText("provide audio_path (a voice memo) or transcript (existing text)");
          }
          let transcription = null;
          let transcript = provided ?? "";
          if (!transcript && args.audio_path) {
            transcription = await transcribeAudio(args.audio_path);
            transcript = transcription.text;
            t.setAttribute("wanderlog.transcription_model", transcription.model);
          } else {
            t.setAttribute("wanderlog.transcription_model", "provided");
          }
          const result = await logVoiceNote(db, transcript, { date: args.date, transcription });
          t.setAttributes({
            "wanderlog.sightings_logged": result.sightings.length,
            "wanderlog.walk_logged": result.walk ? 1 : 0,
          });
          const lines = [
            transcription
              ? `Transcript (ElevenLabs ${transcription.model}${transcription.language ? `, ${transcription.language}` : ""}, zero-retention):`
              : "Transcript (provided; nothing sent to a server):",
            `  "${result.transcript}"`,
            "",
          ];
          if (result.walk) lines.push(`Logged walk #${result.walk.id}: ${walkText(result.walk)}`);
          for (const s of result.sightings) {
            lines.push(`Logged sighting #${s.id}: ${sightingText(s)}`);
          }
          if (!result.walk && result.sightings.length === 0) {
            lines.push("Nothing loggable was found in that note — add a species, place, or walk and try again.");
          }
          lines.push(`Parsed on-device with ${llmModelName()}. Journal now has ${overview(db).sightingCount} sightings.`);
          return text(lines.join("\n"));
        });
      } catch (err) {
        return errorText(`could not log voice note: ${(err as Error).message}`);
      }
    }
  );

  server.registerPrompt(
    "journal-keeper",
    {
      title: "Keep my field journal",
      description:
        "Instructions for an agent acting as the user's naturalist's notebook: log every outing, search before answering, stay on-device.",
      argsSchema: z.object({
        intention: z.string().optional().describe("What the user wants to do with the journal"),
      }),
    },
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              "You are the user's field journal, stored entirely on this machine. Rules:\n" +
              "1. Whenever the user describes something they saw outside, call log_sighting with a species name, category, and location.\n" +
              "2. Whenever they describe an outing, call log_walk.\n" +
              "3. For any question about the past, call search_journal first or answer_question — never guess a date or place.\n" +
              "4. If asked 'where did I see X last time?', answer with the date and place from the top hit.\n" +
              "5. Never claim a sighting exists if search returns nothing; suggest logging it after the next walk.",
          },
        },
      ],
    })
  );

  registerResources(server, db);

  return server;
}

async function main(): Promise<void> {
  await initTracing();
  const db = openDb();
  serveStdio(
    () => createServer(db),
    {
      onerror: (err) => console.error("[wanderlog] connection error:", err),
    }
  );
}

void main();