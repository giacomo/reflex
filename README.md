# reflex

A local decision layer for agents and workflows. You hand it a **state** (text or JSON) and a
**schema** of named questions, each with a fixed list of allowed answers. It hands back a typed
answer per question, a confidence score, which model decided, and how long it took — running
entirely on your machine, on two local models:

- **Fast layer**: [MiniCPM5-1B](https://huggingface.co/openbmb/MiniCPM5-1B-GGUF) (Apache-2.0) answers every question in one call, thinking mode off.
- **Deep layer**: [Spark-X2.5-4B](https://huggingface.co/XHToken/Spark-X2.5-4B-GGUF) (Apache-2.0) re-answers only the questions the fast layer wasn't confident about.

Both run via `llama-server` from the [XHToken/llama.cpp fork](https://github.com/XHToken/llama.cpp)
(MIT, branch `master`), which adds the `Spark2_5ForCausalLM` architecture Spark-X2.5 needs. There is
no cloud dependency and no telemetry: the only network calls reflex makes are to Hugging Face, to
download model weights you asked for.

`reflex` is a working title, kept in one constant (`TOOL_NAME` in `src/constants.ts`) so it's a
one-line change to rename.

## Requirements

- **Linux or macOS.** Windows isn't supported yet — `reflex setup`/`up`/`doctor` fail fast with a
  clear message instead of a confusing spawn error partway through.
- **git, CMake, and a C++ compiler** on `PATH` to build the llama.cpp fork from source. `reflex
  setup` checks for these first and prints install instructions per OS if anything's missing.
- **Memory**: `reflex up` estimates each model's RAM need as `file size × 1.5` (a heuristic, not a
  benchmark) and warns before starting both models if that clearly won't fit, offering to start
  the fast layer alone or use the smaller `spark-x2.5-1.7b` deep model instead.
- An NVIDIA GPU with `nvcc` on `PATH` is used automatically (`-DGGML_CUDA=ON`); Apple Silicon gets
  Metal by default; otherwise it's CPU-only.

## Quickstart

```bash
pnpm install
pnpm build
node dist/cli/index.js setup      # or: npm link, then `reflex setup`
```

`setup` checks prerequisites, clones and builds the llama.cpp fork, downloads both models (after
showing you their size and license — pass `--yes` to skip the prompt), and finishes by running
`doctor`.

```bash
reflex up                         # start both model servers
reflex decide --schema examples/schema.json --state-file examples/state.txt --pretty
reflex down                       # stop them
```

`decide` autostarts the servers if `autostart` is enabled in the config (the default), so `up` is
optional for a one-off call. Example output:

```
QUESTION             ANSWER          CONFIDENCE BY    LATENCY
sentiment            negative        0.94       fast  180ms
priority             high            0.91       fast  180ms
needs_human          yes             0.62       deep  740ms

Total: 950ms, escalation rate: 33%
```

State can also be JSON (`examples/state.json`) or piped via stdin. `--pretty` prints a table;
without it, `decide` prints the same result as JSON, suitable for piping into another program.

## Commands

| Command | What it does |
| --- | --- |
| `reflex setup` | prerequisites → build runtime → pull both models → `doctor` |
| `reflex models list \| pull <name> \| rm <name>` | manage local model weights |
| `reflex up [--fast-only\|--deep-only] [--force]` | start model server(s) |
| `reflex down` | stop model server(s) |
| `reflex status [--json]` | show ports, pids, health |
| `reflex doctor` | prerequisites, binary, models, server health, structured-output/logprobs/ping checks |
| `reflex decide --schema <file> [--state <text>\|--state-file <file>] [--pretty]` | one decision |
| `reflex serve [--port <n>]` | `POST /decide`, `GET /health`, bound to localhost only |
| `reflex bench --tasks <file> [--pretty]` | accuracy/p50/p95/escalation-rate/ECE, fast-only vs. deep-only vs. combined |
| `reflex calibrate --tasks <file>` | fits `router.calibration.temperature` against labeled tasks, saves it to config |

A `tasks.jsonl` file (see `examples/tasks.jsonl`) has one JSON object per line:
`{"schema": {...}, "state": ..., "expected": {"questionName": "answer"}}`.

## Configuration (`reflex.config.json`)

All fields are optional; shown values are the defaults. `runtime.fast.binary` / `runtime.deep.binary`
have no default — omit them entirely unless you want to override the built binary (see below).

```json
{
  "models": { "fast": "minicpm5-1b", "deep": "spark-x2.5-4b" },
  "runtime": {
    "contextSize": { "fast": 4096, "deep": 8192 },
    "gpuLayers": "auto",
    "threads": -1
  },
  "fast": { "temperature": 0.7, "topP": 0.95, "topK": 40, "minP": 0.0 },
  "deep": { "temperature": 1.0, "topP": 0.95, "topK": -1, "minP": 0.0 },
  "router": {
    "threshold": 0.8,
    "onMissingConfidence": "escalate",
    "calibration": { "temperature": 1.0 }
  },
  "ports": { "fast": 8081, "deep": 8082 },
  "server": { "host": "127.0.0.1", "port": 8787 },
  "autostart": true
}
```

- `runtime.contextSize.deep` is kept small on purpose — Spark-X2.5's native 1M-token context needs
  a lot of memory; raise it if you actually need long context and have the RAM for it.
- `runtime.fast.binary` lets you point the fast layer at a different `llama-server` build (e.g. a
  prebuilt one from ggml-org) if the XHToken fork ever doesn't run MiniCPM5 cleanly; `doctor`
  checks for this. `runtime.deep.binary` exists for symmetry but the deep layer normally needs the
  fork's `Spark2_5ForCausalLM` support.
- `fast`/`deep` generation defaults come straight from each model's card (MiniCPM5's no-think
  recommendation; Spark-X2.5's README), including `minP: 0.0` — the MiniCPM llama.cpp cookbook
  notes the library default of `min_p=0.05` can suppress the exact tokens needed to break a
  repetition loop.
- `router.onMissingConfidence`: if a backend doesn't return usable logprobs, confidence is `null`;
  `"escalate"` (default) sends that question to the deep layer anyway, `"accept"` trusts the fast
  answer as-is.
- Respects `HF_TOKEN` (gated/private repos) and `HF_ENDPOINT` (mirrors) from the environment, same
  as the Hugging Face CLI.

Only the two registry models (plus `spark-x2.5-1.7b`, offered as a lower-memory deep-layer
fallback) can be pulled by name. `reflex models pull <name> --unsafe-repo <owner/repo>` bypasses
the registry for anything else, at your own risk (license/architecture aren't verified).

## How confidence and escalation work

1. The fast layer answers *every* question in one call, with JSON-schema-constrained decoding
   (`json_schema` on llama-server's native `/completion` endpoint) and thinking mode off.
2. Per question, reflex finds the answer's token span in the generated JSON and computes the joint
   probability of those tokens, temperature-scaled by `router.calibration.temperature`
   (`reflex calibrate` fits this against labeled tasks).
3. Below `router.threshold`, or if calibration says the answer isn't a good match, that question
   alone is escalated to the deep layer (thinking mode on) — not the whole schema.

## Nuance

Read this before trusting a number reflex prints.

- **No speed/quality claims here aren't backed by a `reflex bench` run in this repo.** This README
  doesn't repeat any numbers about how fast or accurate the fast/deep split is, because none has
  been run against the real models in the environment this was built in (no GPU/compiler available
  there). Run `reflex bench --tasks examples/tasks.jsonl --pretty` yourself and trust that output,
  not general expectations about model size.
- **Confidence is an approximation, not a full-vocabulary probability.** llama-server's `n_probs`
  only returns the top-N alternatives it sampled from at each position, not the full vocabulary
  distribution. Temperature scaling here renormalizes and rescales *within that top-N set*, per
  token, then takes the product across the tokens spanning the answer. This is the honest thing to
  do with the data actually available, but it is not equivalent to textbook temperature scaling
  over the full softmax.
- **`n_probs` on `/completion` is confirmed by the fork's own docs; on `/v1/chat/completions` it is
  not documented at all.** That's why reflex builds the prompt via `/apply-template` and calls the
  native `/completion` endpoint instead of the OpenAI-compatible chat endpoint. If a future backend
  swap doesn't honor `n_probs`, confidence extraction returns `null` for that answer — this is
  treated as a real, expected outcome (`router.onMissingConfidence`), not a bug to paper over.
- **Confidence is fast-layer-only for routing and calibration.** The deep layer's confidence is
  computed and reported the same way, but nothing thresholds on it — it never escalates further.
  `reflex calibrate` also only calibrates against fast-layer confidence, since that's what
  `router.threshold` actually uses.
- **Memory estimates are a heuristic (`file size × 1.5`), not measured.** KV cache size depends on
  context length and how many slots llama-server allocates; if you set `runtime.contextSize.deep`
  much higher than the 8192 default, the real requirement will be higher than this estimate says.
- **The `Spark-X2.5-4B-GGUF` README itself notes that native `spark2_5` support "requires
  llama.cpp `b10828` or later"** on the mainline `ggml-org/llama.cpp`, which may mean this
  architecture lands upstream at some point. reflex still targets the XHToken fork specifically, as
  specified, since that's the version actually verified to work today; if mainline gains the same
  support, pointing `runtime.deep.binary` at it instead is a one-line config change.
- Tests never load a real model — they run against small local HTTP servers standing in for
  `llama-server`'s documented endpoint shapes (`/apply-template`, `/completion` with
  `completion_probabilities`) and a fake Hugging Face API for downloads.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Layout: `src/cli` (thin command wiring), `src/core` (decide/router/confidence/calibration — the
importable library surface, `import { decide } from "reflex"`), `src/models` (registry/download/
cache), `src/runtime` (build the fork, spawn/stop `llama-server`, orchestration), `src/bench`,
`src/server` (the localhost HTTP API), `tests`, `examples`.

## License

Apache-2.0. See [LICENSE](./LICENSE).
