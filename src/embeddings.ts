import { pipeline, env } from "@huggingface/transformers";
import { EMBED_MODEL, OFFLINE } from "./config.js";

interface EmbeddingOutput {
  data: unknown;
  dims: number[];
}

interface Extractor {
  (texts: string | string[], options?: { pooling?: string; normalize?: boolean }): Promise<EmbeddingOutput>;
}

let extractorPromise: Promise<Extractor | null> | null = null;
let initFailureLogged = false;

export function setRemoteModelsAllowed(allowed: boolean): void {
  env.allowRemoteModels = allowed;
}

setRemoteModelsAllowed(!OFFLINE);

export function modelName(): string {
  return EMBED_MODEL;
}

export async function extractor(): Promise<Extractor | null> {
  if (OFFLINE) return null;
  if (!extractorPromise) {
    extractorPromise = (async () => {
      try {
        return (await pipeline("feature-extraction", EMBED_MODEL, { dtype: "q8" })) as unknown as Extractor;
      } catch (err) {
        if (!initFailureLogged) {
          initFailureLogged = true;
          console.error(
            `[wanderlog] could not load embedding model "${EMBED_MODEL}": ${(err as Error).message}`
          );
          console.error(
            "[wanderlog] falling back to keyword search. Set WANDERLOG_OFFLINE=1 to silence, or remove WANDERLOG_EMBED_MODEL to use the default model."
          );
        }
        return null;
      }
    })();
  }
  return extractorPromise;
}

export async function embedTexts(texts: string[]): Promise<Float32Array[] | null> {
  const ex = await extractor();
  if (!ex) return null;
  const output = await ex(texts, { pooling: "mean", normalize: true });
  const dims = output.dims;
  if (dims.length !== 2) {
    throw new Error(`unexpected embedding shape: ${dims.join("x")}`);
  }
  const [n, d] = dims;
  const data = output.data as Float32Array;
  const vectors: Float32Array[] = new Array(n);
  for (let i = 0; i < n; i++) {
    vectors[i] = data.slice(i * d, (i + 1) * d);
  }
  return vectors;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "at", "by", "for", "in", "of", "on", "to", "with",
  "was", "were", "is", "are", "i", "we", "my", "it", "its", "that", "this", "from", "had",
  "have", "has", "do", "did", "does", "saw", "see", "seen", "there", "at", "last", "time",
  "when", "where", "what", "around", "near", "about", "just", "very", "then", "than",
]);

export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length > 1 && !STOPWORDS.has(raw)) {
      tokens.add(raw);
    }
  }
  return tokens;
}

export function keywordOverlap(queryTokens: Set<string>, docTokens: Set<string>): number {
  if (queryTokens.size === 0 || docTokens.size === 0) return 0;
  let hits = 0;
  for (const t of queryTokens) {
    if (docTokens.has(t)) hits++;
  }
  return hits / Math.sqrt(queryTokens.size * docTokens.size);
}