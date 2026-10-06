# WanderLog

A **local-first field journal** for people who spend time outside.

WanderLog is a Model Context Protocol (MCP) server that turns your coding
agent into a naturalist's notebook. Log the birds, plants, and trails you see
on a walk; later ask in plain language *"where did I see the kingfisher last
time?"* — and get an answer computed **entirely on your machine**.

- **Open-source AI at the core.** Semantic search runs on an open-weight
  sentence-transformer (`Xenova/all-MiniLM-L6-v2`, Apache-2.0) executing
  in-process via [Transformers.js](https://huggingface.co/docs/transformers.js)
  and ONNX Runtime. The optional Q&A layer runs any local open-weight LLM
  (e.g. `gemma3`) through [Ollama](https://ollama.com). No API keys, no cloud.
- **No internet required.** After the first run, the embedding model is cached
  and every query is answered with zero network calls. Your sightings, notes,
  and locations never leave the SQLite file on your disk.
- **Swap anything.** The embedding model is an environment variable away
  (`WANDERLOG_EMBED_MODEL`); change it, and new entries are embedded with it.
  The Q&A model is a variable too.

Built for the **Hacktoberfest Open-Source AI Challenge (Week 1): Touch Grass**.

---

## Why a field journal?

Screens make decent places to *look at* birds, but the birds are outside.
WanderLog is built around one rule: **the screen is the shortest part of the
experience.** You go outside, you notice things, and when you get back you
spend about ten seconds telling your agent what you saw. The journal takes
care of remembering — including *where* and *when* — so the next outing can
pick up where the last one left off.

Closed alternatives (eBird, iNaturalist, note-taking apps with embedding
APIs) all send your sightings — and, crucially, **their locations** — to
servers you don't control. WanderLog keeps the whole notebook in one SQLite
file on your laptop: `~/.wanderlog/journal.db`.

## Features

| Tool | What it does |
| --- | --- |
| `log_sighting` | Record a species, category, place, weather, notes |
| `log_walk` | Record an outing: trail, distance, duration, notes |
| `search_journal` | Hybrid semantic + keyword search over past entries — computed locally |
| `answer_question` | Natural-language Q&A over the journal (local Ollama model if configured, best-evidence fallback otherwise) |
| `journal_overview` | Totals, category counts, last outing |

Resources (readable by any MCP client):

- `journal://stats`
- `journal://day/{YYYY-MM-DD}`
- `journal://category/{bird|plant|animal|insect|fungi|other}`
- `journal://walk/{id}`

## Quick start

Requires Node.js 20+.

```bash
npm install

# (Optional) a local LLM for natural-language answers
ollama pull gemma3:4b        # ~3 GB, runs fully offline

# Try the demo end-to-end (seeds a demo journal on first run)
npm run seed
npm run demo
```

Example `npm run demo` output (abridged):

```
  "where did I see the kingfisher last time?"

     1. [2026-10-03] sighting #10 — white-breasted kingfisher at Maota Lake, Amber
        score=0.465 semantic=0.500
     2. [2026-09-27] sighting #1 — white-breasted kingfisher at Central Park lake jetty
```

## Using it with your agent

Add WanderLog to your MCP client:

```jsonc
// Claude Code: .mcp.json
{
  "mcpServers": {
    "wanderlog": {
      "command": "npx",
      "args": ["tsx", "src/server.ts"],
      "env": { "WANDERLOG_OLLAMA_MODEL": "gemma3:4b" }
    }
  }
}
```

Then, in your agent:

> "Log a sighting: white-breasted kingfisher, at the Maota Lake jetty, golden
> hour, dove twice and came up with a fish."

> "Log that walk — 2.4 km, 55 minutes, Maota Lake trail."

> "Where did I see the kingfisher last time?"

## Testing

```bash
npm run typecheck   # strict TypeScript
npm test            # hermetic smoke test: spawns the server, exercises every
                    # tool + resource over stdio (offline mode, no model download)
```

## How the open pieces fit

- **Embeddings** — `@huggingface/transformers` loads an open-weight ONNX
  model (`Xenova/all-MiniLM-L6-v2`) and runs it with ONNX Runtime in-process.
  First run downloads ~23 MB to the Hugging Face cache; every run after that
  is offline. If the model can't load, search degrades gracefully to keyword
  overlap — the journal still works.
- **Q&A** — `answer_question` retrieves the top evidence locally, then asks
  a local Ollama model (`gemma3:4b`, or `llama3.2:3b`) to answer strictly
  from that context, citing entry numbers. No Ollama? It returns the ranked
  evidence instead.
- **Storage** — SQLite (better-sqlite3) with an `embeddings` table holding
  float vectors as blobs. No vector database needed at field-journal scale;
  cosine similarity runs in a few milliseconds.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `WANDERLOG_DB` | `~/.wanderlog/journal.db` | SQLite file (use `:memory:` for tests) |
| `WANDERLOG_EMBED_MODEL` | `Xenova/all-MiniLM-L6-v2` | Any Transformers.js-compatible embedding model |
| `WANDERLOG_OLLAMA_HOST` | `http://127.0.0.1:11434` | Local Ollama endpoint |
| `WANDERLOG_OLLAMA_MODEL` | *(empty)* | Enables `answer_question`, e.g. `gemma3:4b` |
| `WANDERLOG_OFFLINE` | *(unset)* | `1` = never download models, keyword search only |

## Privacy

The journal is yours alone. Changing `WANDERLOG_EMBED_MODEL` swaps how *your*
notebook understands you — the point of open weights is that nobody else gets
to decide how your data is interpreted, or where it goes.

## License

MIT. The embedding model is Apache-2.0; the Q&A model is Gemma (Google,
Gemma Terms of Use) or Llama (Meta, Llama Community License) depending on
what you run locally.