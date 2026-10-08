import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod/v4";
import {
  ELEVENLABS_API_KEY,
  ELEVENLABS_STT_MODEL,
  OFFLINE,
  OLLAMA_HOST,
  OLLAMA_MODEL,
} from "./config.js";
import { insertSighting, insertWalk, type Db } from "./db.js";
import { ensureEmbeddedFor } from "./search.js";
import { llmAvailable } from "./llm.js";
import { trace } from "./tracing.js";
import { CATEGORIES, type Category, type Sighting, type Walk } from "./types.js";

const VoiceNoteSchema = z.object({
  walk: z
    .object({
      trail: z.string().trim().min(1).optional(),
      distance_km: z.coerce.number().positive().optional(),
      duration_min: z.coerce.number().positive().optional(),
      notes: z.string().trim().min(1).optional(),
    })
    .nullish()
    .transform((v) => v ?? null),
  sightings: z
    .array(
      z.object({
        species: z.string().trim().min(1),
        category: z.enum(CATEGORIES).catch("other"),
        location: z.string().trim().min(1).optional(),
        notes: z.string().trim().min(1).optional(),
      })
    )
    .default([]),
});

export type VoiceNote = z.infer<typeof VoiceNoteSchema>;

export interface Transcription {
  text: string;
  provider: "elevenlabs";
  model: string;
  language?: string;
}

export interface LogVoiceResult {
  transcript: string;
  transcription: Transcription | null;
  walk: Walk | null;
  sightings: Sighting[];
}

export async function transcribeAudio(filePath: string): Promise<Transcription> {
  if (OFFLINE) {
    throw new Error(
      "WANDERLOG_OFFLINE=1 is set — transcription needs the network. Pass an existing transcript instead."
    );
  }
  if (!ELEVENLABS_API_KEY) {
    throw new Error(
      "ELEVENLABS_API_KEY is not set — export it to transcribe voice memos, or pass an existing transcript instead."
    );
  }

  const audio = await fs.readFile(filePath);
  return trace(
    {
      name: `transcribe ${path.basename(filePath)}`,
      op: "gen_ai.transcription",
      attributes: {
        "gen_ai.operation.name": "transcription",
        "gen_ai.provider.name": "elevenlabs",
        "gen_ai.request.model": ELEVENLABS_STT_MODEL,
      },
    },
    async (t) => {
      const form = new FormData();
      form.append("model_id", ELEVENLABS_STT_MODEL);
      form.append("file", new Blob([audio]), path.basename(filePath));

      const keepLogging = process.env.WANDERLOG_STT_LOGGING === "1";
      const url =
        "https://api.elevenlabs.io/v1/speech-to-text" + (keepLogging ? "" : "?enable_logging=false");

      const res = await fetch(url, {
        method: "POST",
        headers: { "xi-api-key": ELEVENLABS_API_KEY },
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        if (!keepLogging && res.status === 403 && /ZRM|zero[- ]retention/i.test(detail)) {
          throw new Error(
            "ElevenLabs plan does not support zero-retention mode — set WANDERLOG_STT_LOGGING=1 " +
              "to let ElevenLabs keep the audio for this transcription, or pass an existing transcript instead."
          );
        }
        throw new Error(`ElevenLabs transcription failed: HTTP ${res.status} ${detail}`);
      }
      const body = (await res.json()) as { text?: string; language_code?: string };
      const text = (body.text ?? "").trim();
      if (!text) throw new Error("ElevenLabs returned an empty transcript");

      t.setAttributes({
        "wanderlog.audio_bytes": audio.byteLength,
        "wanderlog.transcript_chars": text.length,
      });
      if (body.language_code) t.setAttribute("wanderlog.language", body.language_code);
      return {
        text,
        provider: "elevenlabs",
        model: ELEVENLABS_STT_MODEL,
        language: body.language_code,
      };
    }
  );
}

export function parseVoiceNoteJson(raw: string): VoiceNote {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("local model did not return JSON");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error("local model returned invalid JSON");
  }
  const result = VoiceNoteSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`local model JSON did not match the expected shape: ${result.error.message}`);
  }
  return result.data;
}

export async function structureTranscript(transcript: string): Promise<VoiceNote> {
  const prompt = [
    "You convert a spoken naturalist's field note into structured JSON for a field journal.",
    "Return ONLY JSON, no markdown, no commentary, matching exactly this shape:",
    '{ "walk": { "trail": string, "distance_km": number, "duration_min": number, "notes": string } | null,',
    '  "sightings": [ { "species": string, "category": string, "location": string, "notes": string } ] }',
    `"category" must be one of: ${CATEGORIES.join(", ")}.`,
    "Rules:",
    "- Record only what the speaker actually said. Never invent a species, place, or number.",
    "- If they describe an outing (a walk, run, or route), fill walk; otherwise walk is null.",
    "- One entry in sightings per distinct thing they observed.",
    "- Put behavior and context in notes; put the place name in location.",
    "- If the speaker's wording is ambiguous, keep their words rather than guessing.",
    "",
    `Spoken note: "${transcript}"`,
    "",
    "JSON:",
  ].join("\n");

  return trace(
    {
      name: `structure note with ${OLLAMA_MODEL}`,
      op: "gen_ai.chat",
      attributes: {
        "gen_ai.operation.name": "chat",
        "gen_ai.provider.name": "ollama",
        "gen_ai.request.model": OLLAMA_MODEL,
      },
    },
    async (t) => {
      const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: [{ role: "user", content: prompt }],
          stream: false,
          format: "json",
          options: { temperature: 0.1, num_ctx: 4096 },
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`ollama chat failed: HTTP ${res.status}`);
      const body = (await res.json()) as {
        message?: { content?: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };
      if (typeof body.prompt_eval_count === "number") {
        t.setAttribute("gen_ai.usage.input_tokens", body.prompt_eval_count);
      }
      if (typeof body.eval_count === "number") {
        t.setAttribute("gen_ai.usage.output_tokens", body.eval_count);
      }
      const note = parseVoiceNoteJson(body.message?.content ?? "");
      t.setAttributes({
        "wanderlog.sightings_found": note.sightings.length,
        "wanderlog.walk_found": note.walk ? 1 : 0,
      });
      return note;
    }
  );
}

async function embedQuietly(db: Db, kind: "sighting" | "walk", id: number): Promise<void> {
  try {
    await ensureEmbeddedFor(db, kind, id);
  } catch (err) {
    console.error(`[wanderlog] embedding ${kind} #${id} failed: ${(err as Error).message}`);
  }
}

export async function logVoiceNote(
  db: Db,
  transcript: string,
  opts: { date?: string; transcription?: Transcription | null } = {}
): Promise<LogVoiceResult> {
  if (!(await llmAvailable())) {
    throw new Error(
      'no local model is available — run "ollama pull gemma3:4b" and set WANDERLOG_OLLAMA_MODEL=gemma3:4b'
    );
  }
  const note = await structureTranscript(transcript);

  const walk = note.walk
    ? insertWalk(db, {
        date: opts.date,
        trail: note.walk.trail,
        distanceKm: note.walk.distance_km,
        durationMin: note.walk.duration_min,
        notes: note.walk.notes,
      })
    : null;
  if (walk) await embedQuietly(db, "walk", walk.id);

  const sightings: Sighting[] = [];
  for (const s of note.sightings) {
    const sighting = insertSighting(db, {
      species: s.species,
      category: s.category as Category,
      location: s.location,
      notes: s.notes,
      walkId: walk?.id,
    });
    await embedQuietly(db, "sighting", sighting.id);
    sightings.push(sighting);
  }

  return { transcript, transcription: opts.transcription ?? null, walk, sightings };
}
