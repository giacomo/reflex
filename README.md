# reflex

A local decision layer for agents and workflows. You hand it a **state** (text or JSON) and a
**schema** of named questions, each with a fixed list of allowed answers. It hands back a typed
answer per question, a confidence score, which model decided, and how long it took — running
entirely on your machine, on two local models:

- **Fast layer**: [MiniCPM5-1B](https://huggingface.co/openbmb/MiniCPM5-1B-GGUF) (Apache-2.0) answers every question in one call, thinking mode off.
- **Deep layer**: [Spark-X2.5-4B](https://huggingface.co/XHToken/Spark-X2.5-4B-GGUF) (Apache-2.0) re-answers only the questions the fast layer wasn't confident about.

Both run on `llama-server` from [llama.cpp](https://github.com/ggml-org/llama.cpp) (MIT). Spark-X2.5
needs the `Spark2_5ForCausalLM` architecture, added to the [XHToken/llama.cpp
fork](https://github.com/XHToken/llama.cpp) first and since merged into mainline llama.cpp
([ggml-org/llama.cpp#27868](https://github.com/ggml-org/llama.cpp/pull/27868), released from build
b10828 on). There is no cloud dependency and no telemetry: the only network calls reflex makes are
to Hugging Face (model weights) and GitHub (the llama.cpp runtime), both of which you can point at
your own mirrors via `HF_ENDPOINT`.

`reflex` is a working title, kept in one constant (`TOOL_NAME` in `src/constants.ts`) so it's a
one-line change to rename.

## Requirements

- **Linux, macOS, or Windows.**
  - **Linux/macOS**: builds the XHToken fork from source by default (needs git, CMake, and a C++
    compiler — `reflex setup` checks for these and prints install instructions if anything's
    missing), falling back to a downloaded prebuilt binary if no compiler is found.
  - **Windows**: always downloads a prebuilt `llama-server` from the official
    [ggml-org/llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases) instead of trying
    to automate an MSVC/clang build. This works because mainline llama.cpp now has native Spark2_5
    support (see above) — no fork-specific binary is needed. `reflex` always resolves the *latest*
    compatible release rather than a pinned one.
- **Memory**: `reflex up` estimates each model's RAM need as `file size × 1.5` (a heuristic, not a
  benchmark) and warns before starting both models if that clearly won't fit, offering to start
  the fast layer alone or use the smaller `spark-x2.5-1.7b` deep model instead.
- Building from source: an NVIDIA GPU with `nvcc` on `PATH` is used automatically
  (`-DGGML_CUDA=ON`); Apple Silicon gets Metal by default; otherwise it's CPU-only. The Windows/
  fallback prebuilt path is CPU-only — point `runtime.fast.binary` / `runtime.deep.binary` at a
  CUDA/Vulkan build from the same releases page yourself if you want GPU acceleration there.

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
- **The prebuilt/fallback path always resolves the *latest* ggml-org/llama.cpp release**, not a
  pinned version, since these nightly-style `bNNNN` builds are meant to always work standalone.
  This means the exact binary in use can change between runs on a machine that uses the fallback
  path (recorded each time in `lock.json` for traceability) — a deliberate tradeoff for not having
  to maintain a version pin, per how these releases are meant to be consumed.
- Tests never load a real model — they run against small local HTTP servers standing in for
  `llama-server`'s documented endpoint shapes (`/apply-template`, `/completion` with
  `completion_probabilities`), a fake Hugging Face API for model downloads, and a fake GitHub API
  for the prebuilt-binary path (verified for real, including actual `tar`-based zip/tar.gz
  extraction, in addition to the mocked tests).

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
