import { OLLAMA_HOST, OLLAMA_MODEL, OFFLINE } from "./config.js";
import type { SearchHit } from "./types.js";

let availability: boolean | null = null;
let availabilityCheckedAt = 0;

export async function llmAvailable(): Promise<boolean> {
  if (!OLLAMA_MODEL || OFFLINE) return false;
  if (availability === null || Date.now() - availabilityCheckedAt > 30_000) {
    availabilityCheckedAt = Date.now();
    try {
      const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(1500) });
      const body = (await res.json()) as { models?: { name: string }[] };
      availability = res.ok && (body.models ?? []).some((m) => m.name.startsWith(OLLAMA_MODEL));
    } catch {
      availability = false;
    }
  }
  return availability;
}

export function llmModelName(): string {
  return OLLAMA_MODEL;
}

export async function generateAnswer(question: string, hits: SearchHit[]): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const context = hits
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8)
    .map((h, i) => {
      const where =
        h.kind === "sighting" ? `${h.location ?? "unspecified location"}\n  species: ${h.species ?? ""}` : `trail: ${h.trail ?? "unspecified trail"}`;
      return `[${i + 1}] (${h.date}) ${h.kind} #${h.id}\n  ${where}\n  note: ${h.text}`;
    })
    .join("\n\n");

  const prompt = [
    `Today's date is ${today}. You are a naturalist's field journal assistant.`,
    "Answer the question using ONLY the journal entries below.",
    "The entries are listed newest first: [1] has the latest date, and every next number is older.",
    "If the question asks for the most recent event or 'the last time', answer with entry [1] among the relevant matches, and state its place and date.",
    "If the question asks how many times something happened, count every relevant entry and list their dates.",
    "If the answer is not in the journal, say so plainly. Never invent a sighting.",
    "Journal entries (newest first):",
    context,
    "",
    `Question: ${question}`,
    "",
    "Answer:",
  ].join("\n");

  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.2, num_ctx: 4096 },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    throw new Error(`ollama generate failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { response?: string };
  return (body.response ?? "").trim();
}