# WanderLog

A **local-first field journal** for people who spend time outside.

WanderLog is a Model Context Protocol (MCP) server that turns your coding
agent into a naturalist's notebook. Log the birds, plants, and trails you see
on a walk; later ask in plain language *"where did I see the kingfisher last
time?"* — and get an answer computed **entirely on your machine**.

- **Open-source AI at the core.** Semantic search runs on an open-weight
  sentence-transformer (`Xenova/all-MiniLM-L6-v2`, Apache-2.0) executing
  in-process via [Transformers.js](https://huggingface.co/docs/transformers.js)
  and ONNX Runtime. Everything that *understands* your journal — Q&A and
  voice-note parsing — runs on **Gemma** (`gemma3:4b`) through
  [Ollama](https://ollama.com), on your machine. No API keys, no cloud.
- **No internet required.** After the first run, the embedding model is cached
  and every query is answered with zero network calls. Your sightings, notes,
  and locations never leave the SQLite file on your disk.
- **Voice-first.** A voice memo from the trail becomes structured journal
  entries: ElevenLabs Scribe transcribes it (optional, zero-retention), and
  your local gemma3 extracts the species, places, and walk on-device.
- **Swap anything.** The embedding model is an environment variable away
  (`WANDERLOG_EMBED_MODEL`); change it, and new entries are embedded with it.
  The Q&A and parsing model is a variable too — anything Ollama can run.

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
| `log_voice_note` | Voice memo → structured entries: ElevenLabs Scribe (optional) transcribes, local gemma3 parses |
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

## Voice notes: the screen as the shortest part

The fastest way to use WanderLog is to say what you saw. Record a voice memo
on your phone while you're out, then at home:

```bash
export ELEVENLABS_API_KEY=...             # optional, for transcription
export WANDERLOG_OLLAMA_MODEL=gemma3:4b   # the model that parses it

npm run log-voice -- ~/walk.m4a
```

```
transcribing /Users/you/walk.m4a with ElevenLabs...
transcript (scribe_v2, en):
  "saw a white-breasted kingfisher at the lake jetty, dove twice and got
   a fish. Also a flock of about forty parakeets heading west. Walk was
   three point two kilometers, fifty minutes, fog on the lake."

logged walk #12
a walk on Central Park loop, 3.2 km, 50 minutes, fog on the lake. Walked on 2026-10-09.
logged sighting #13
bird white-breasted kingfisher, at the lake jetty, dove twice and got a fish. ...
```

Or let your agent do it: *"Here's my voice memo from this morning's walk —
log it: ~/walk.m4a"* — the `log_voice_note` tool does the same thing.

- **Transcription is the only cloud step, and it's optional.** ElevenLabs
  Scribe asks for `enable_logging=false` (zero-retention) by default; that
  mode needs an ElevenLabs enterprise (or trial) plan, so on other plans set
  `WANDERLOG_STT_LOGGING=1` and ElevenLabs keeps the audio.
- **Parsing, search, and storage stay local.** gemma3 turns free speech into
  structured sightings and walks; the embedding model indexes them.
- **Fully offline path:** pass an existing transcript
  (`npm run log-voice -- --transcript "..."`) or set `WANDERLOG_OFFLINE=1`;
  then no network call happens at all.

## Tracing your agent with Sentry

Set `SENTRY_DSN` and every journal operation becomes a trace:

```
execute_tool log_voice_note          (gen_ai.execute_tool)
├── transcribe walk.m4a              (gen_ai.transcription, elevenlabs)
├── structure note with gemma3:4b    (gen_ai.chat, 210 in / 64 out tokens)
├── embed 1 text                     (gen_ai.embeddings)
└── embed 1 text                     (gen_ai.embeddings)

execute_tool answer_question         (gen_ai.execute_tool)
├── search journal                   (function, 4 hits, semantic rerank)
└── answer with gemma3:4b            (gen_ai.chat, 486 in / 71 out tokens)
```

Each tool span records its arguments and result counts; the model spans record
model name, token counts, and latency. With a local model the cost is $0.00 —
the trace makes it visible. Without `SENTRY_DSN`, tracing is a no-op and the
journal stays fully offline.

## Testing

```bash
npm run typecheck   # strict TypeScript
npm test            # hermetic, no network: voice pipeline unit tests (stubbed
                    # ElevenLabs + Ollama), then a smoke test that spawns the
                    # server and exercises every tool + resource over stdio
```

## How the open pieces fit

- **Embeddings** — `@huggingface/transformers` loads an open-weight ONNX
  model (`Xenova/all-MiniLM-L6-v2`) and runs it with ONNX Runtime in-process.
  First run downloads ~23 MB to the Hugging Face cache; every run after that
  is offline. If the model can't load, search degrades gracefully to keyword
  overlap — the journal still works.
- **Q&A and parsing** — Gemma (`gemma3:4b` via Ollama) is the brain for both
  `answer_question` and voice-note extraction. It runs entirely on your
  machine, is one environment variable away from any other Ollama model, and
  costs nothing per call. No Ollama? Q&A returns the ranked evidence instead.
- **Transcription** *(optional)* — ElevenLabs Scribe converts a voice memo to
  text when `ELEVENLABS_API_KEY` is set, with zero-retention by default. It is
  the only cloud step in the project and you can skip it entirely by passing a
  transcript — the rest of the pipeline never needs the network.
- **Storage** — SQLite (better-sqlite3) with an `embeddings` table holding
  float vectors as blobs. No vector database needed at field-journal scale;
  cosine similarity runs in a few milliseconds.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `WANDERLOG_DB` | `~/.wanderlog/journal.db` | SQLite file (use `:memory:` for tests) |
| `WANDERLOG_EMBED_MODEL` | `Xenova/all-MiniLM-L6-v2` | Any Transformers.js-compatible embedding model |
| `WANDERLOG_OLLAMA_HOST` | `http://127.0.0.1:11434` | Local Ollama endpoint |
| `WANDERLOG_OLLAMA_MODEL` | *(empty)* | Enables `answer_question` and voice-note parsing, e.g. `gemma3:4b` |
| `WANDERLOG_OFFLINE` | *(unset)* | `1` = never download models, keyword search only |
| `ELEVENLABS_API_KEY` | *(empty)* | Enables audio → text transcription for voice notes |
| `WANDERLOG_STT_MODEL` | `scribe_v2` | ElevenLabs transcription model |
| `WANDERLOG_STT_LOGGING` | *(unset)* | `1` = allow ElevenLabs to retain audio (zero-retention needs an enterprise/trial plan) |
| `SENTRY_DSN` | *(empty)* | Enables agent tracing; unset = tracing is a no-op |
| `SENTRY_TRACES_SAMPLE_RATE` | `1.0` | Sentry trace sampling |

## Privacy

The journal is yours alone. Changing `WANDERLOG_EMBED_MODEL` swaps how *your*
notebook understands you — the point of open weights is that nobody else gets
to decide how your data is interpreted, or where it goes.

## License

MIT. The embedding model is Apache-2.0; the Q&A and parsing model is Gemma
(Google, Gemma Terms of Use) or Llama (Meta, Llama Community License)
depending on what you run locally. Voice transcription optionally uses the
ElevenLabs API, a hosted service governed by ElevenLabs' terms.