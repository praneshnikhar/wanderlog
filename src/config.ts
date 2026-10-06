import path from "node:path";
import os from "node:os";

export const DB_PATH =
  process.env.WANDERLOG_DB ?? path.join(os.homedir(), ".wanderlog", "journal.db");

export const EMBED_MODEL =
  process.env.WANDERLOG_EMBED_MODEL ?? "Xenova/all-MiniLM-L6-v2";

export const OLLAMA_HOST = process.env.WANDERLOG_OLLAMA_HOST ?? "http://127.0.0.1:11434";

export const OLLAMA_MODEL = process.env.WANDERLOG_OLLAMA_MODEL ?? "";

export const OFFLINE = process.env.WANDERLOG_OFFLINE === "1";