import { Command } from "commander";
import { loadConfig, type ReflexConfig } from "../../config.js";
import { runtimeDir } from "../../paths.js";
import { LlamaCppRuntime } from "../../runtime/runtime.js";
import { getLocalModelPath, readManifest } from "../../models/manager.js";
import { statusAll } from "../../runtime/orchestrator.js";
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

  const prereqs = runtime.checkPrerequisites();
  checks.push({
    name: "prerequisites",
    ok: prereqs.ok,
    detail: prereqs.ok
      ? `git, cmake, ${prereqs.compilerName ?? "compiler"} found${prereqs.nvcc ? ", nvcc found (CUDA available)" : ""}`
      : prereqs.missingInstructions.join(" "),
  });

  const binaryPath = runtime.binaryPath();
  const binaryExists = fs.existsSync(binaryPath);
  checks.push({
    name: "runtime binary",
    ok: binaryExists,
    detail: binaryExists ? binaryPath : `not built yet (${binaryPath}); run "reflex setup"`,
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
