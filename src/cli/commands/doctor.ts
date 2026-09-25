import { Command } from "commander";
import { loadConfig, type ReflexConfig } from "../../config.js";
import { runtimeDir } from "../../paths.js";
import { LlamaCppRuntime } from "../../runtime/runtime.js";
import { getLocalModelPath, readManifest } from "../../models/manager.js";
import { statusAll, serverHandle } from "../../runtime/orchestrator.js";
import { isSupportedPlatform, unsupportedPlatformMessage, usesPrebuiltByDefault } from "../../runtime/platform.js";
import { readLock } from "../../runtime/lock.js";
import { parseDecisionSchema, toJsonSchema } from "../../core/schema.js";
import { buildMessages } from "../../core/prompt.js";
import { applyTemplate, complete } from "../../core/backend.js";
import { extractTokenLogprobs } from "../../core/confidence.js";
import fs from "node:fs";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * Runs the checks that don't require a live server: prerequisites, the
 * built binary, and pulled models. Server-reachability and structured-output
 * / logprobs checks are added once the backend client exists (see decide.ts).
 */
export async function runDoctor(config: ReflexConfig): Promise<boolean> {
  const checks: Check[] = [];
  const runtime = new LlamaCppRuntime(runtimeDir());

  const platformOk = isSupportedPlatform();
  checks.push({
    name: "platform",
    ok: platformOk,
    detail: platformOk ? process.platform : unsupportedPlatformMessage(),
  });

  const prereqs = runtime.checkPrerequisites();
  if (usesPrebuiltByDefault()) {
    checks.push({
      name: "build toolchain",
      ok: true,
      detail: "not needed on this platform: reflex downloads a prebuilt llama-server instead of building from source",
    });
  } else {
    checks.push({
      name: "build toolchain",
      ok: true,
      detail: prereqs.ok
        ? `git, cmake, ${prereqs.compilerName ?? "compiler"} found${prereqs.nvcc ? ", nvcc found (CUDA available)" : ""}: will build from source`
        : `${prereqs.missingInstructions.join(" ")} Falling back to a downloaded prebuilt llama-server instead.`,
    });
  }

  const binaryPath = runtime.binaryPath();
  const binaryExists = fs.existsSync(binaryPath);
  const lock = readLock(runtimeDir());
  const lockDetail =
    lock?.source === "source"
      ? `built from source, commit ${lock.commitHash.slice(0, 12)}`
      : lock?.source === "prebuilt"
        ? `prebuilt ${lock.repo}@${lock.tag}`
        : undefined;
  checks.push({
    name: "runtime binary",
    ok: binaryExists,
    detail: binaryExists
      ? `${binaryPath}${lockDetail ? ` (${lockDetail})` : ""}`
      : `not set up yet (${binaryPath}); run "reflex setup"`,
  });

  for (const role of ["fast", "deep"] as const) {
    const name = config.models[role];
    const manifest = readManifest(name);
    const localPath = getLocalModelPath(name);
    checks.push({
      name: `${role} model (${name})`,
      ok: localPath !== undefined,
      detail: localPath
        ? `${localPath}${manifest?.requiresRuntime === "fork" ? " (requires the XHToken fork)" : ""}`
        : `not pulled; run "reflex models pull ${name}"`,
    });
  }

  const statuses = await statusAll(config);
  for (const s of statuses) {
    checks.push({
      name: `${s.role} server`,
      ok: s.healthy,
      detail: s.running ? (s.healthy ? `healthy on port ${s.port}` : `running but not healthy (port ${s.port})`) : "not running",
    });
  }

  const fastStatus = statuses.find((s) => s.role === "fast");
  if (fastStatus?.healthy) {
    const fastBaseUrl = serverHandle(config, "fast").baseUrl;
    try {
      const pingSchema = parseDecisionSchema({ questions: [{ name: "ping", options: ["ok"] }] });
      const messages = buildMessages("Reply to this health check.", pingSchema);
      const jsonSchema = toJsonSchema(pingSchema);
      const startedAt = Date.now();
      const prompt = await applyTemplate(fastBaseUrl, messages);
      const result = await complete(fastBaseUrl, prompt, {
        jsonSchema,
        generation: config.fast,
        nProbs: 3,
      });
      const latencyMs = Date.now() - startedAt;

      let structuredOk = false;
      try {
        const parsed = JSON.parse(result.content) as Record<string, unknown>;
        structuredOk = typeof parsed["ping"] === "string";
      } catch {
        structuredOk = false;
      }
      checks.push({
        name: "structured output (fast)",
        ok: structuredOk,
        detail: structuredOk ? `valid JSON: ${result.content}` : `invalid JSON: ${result.content}`,
      });

      const tokens = extractTokenLogprobs(result.raw);
      checks.push({
        name: "logprobs (fast)",
        ok: tokens !== undefined,
        detail:
          tokens !== undefined
            ? `n_probs honored (${tokens.length} tokens with logprobs)`
            : `no usable completion_probabilities in the response; confidence will be null and ` +
              `router.onMissingConfidence ("${config.router.onMissingConfidence}") decides escalation`,
      });

      checks.push({ name: "ping latency (fast)", ok: true, detail: `${latencyMs}ms` });
    } catch (err) {
      checks.push({
        name: "structured output (fast)",
        ok: false,
        detail: (err as Error).message,
      });
    }
  } else {
    checks.push({
      name: "structured output (fast)",
      ok: false,
      detail: "fast server is not healthy; skipped",
    });
  }

  let allOk = true;
  for (const check of checks) {
    process.stdout.write(`[${check.ok ? "ok" : "FAIL"}] ${check.name}: ${check.detail}\n`);
    if (!check.ok) allOk = false;
  }
  return allOk;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Check prerequisites, the runtime build, models, and server health")
    .option("--config <path>", "path to reflex.config.json")
    .action(async (opts: { config?: string }) => {
      const config = loadConfig(opts.config);
      const ok = await runDoctor(config);
      process.exitCode = ok ? 0 : 1;
    });
}
