import { Command } from "commander";
import { loadConfig, ConfigError, type ReflexConfig } from "../../config.js";
import { upAll, downAll, statusAll, OrchestratorError, type Role } from "../../runtime/orchestrator.js";
import { UnsupportedPlatformError } from "../../runtime/platform.js";
import { pullModel, ModelManagerError } from "../../models/manager.js";
import { formatBytes } from "../format.js";
import { confirm } from "../prompt.js";
import { renderProgress } from "../progress.js";

const SMALLER_DEEP_MODEL = "spark-x2.5-1.7b";

function handleKnownErrors(err: unknown): never | void {
  if (
    err instanceof ConfigError ||
    err instanceof OrchestratorError ||
    err instanceof UnsupportedPlatformError ||
    err instanceof ModelManagerError
  ) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
    return;
  }
  throw err;
}

export function registerUpDownStatusCommands(program: Command): void {
  program
    .command("up")
    .description("Start the fast and/or deep model servers")
    .option("--config <path>", "path to reflex.config.json")
    .option("--fast-only", "only start the fast model server", false)
    .option("--deep-only", "only start the deep model server", false)
    .option("--force", "skip the pre-flight memory check", false)
    .action(async (opts: { config?: string; fastOnly: boolean; deepOnly: boolean; force: boolean }) => {
      try {
        const config = loadConfig(opts.config);
        const only: Role[] | undefined = opts.fastOnly ? ["fast"] : opts.deepOnly ? ["deep"] : undefined;

        let outcome = await upAll(config, { ...(only ? { only } : {}), force: opts.force });
        if (outcome.kind === "insufficient-memory") {
          const { memory } = outcome;
          process.stdout.write(
            `Not enough free memory to start ${memory.requirements.map((r) => r.name).join(" + ")}: ` +
              `need ~${formatBytes(memory.totalRequiredBytes)}, have ${formatBytes(memory.availableBytes)} free.\n`,
          );
          if (only) {
            process.stdout.write("Aborting (use --force to start anyway).\n");
            process.exitCode = 1;
            return;
          }
          const fastOnly = await confirm("Start only the fast model instead?");
          if (fastOnly) {
            outcome = await upAll(config, { only: ["fast"] });
          } else if (
            config.models.deep !== SMALLER_DEEP_MODEL &&
            (await confirm(`Use the smaller ${SMALLER_DEEP_MODEL} for the deep layer instead?`))
          ) {
            const smallerConfig: ReflexConfig = {
              ...config,
              models: { ...config.models, deep: SMALLER_DEEP_MODEL },
            };
            const pulled = await pullModel(SMALLER_DEEP_MODEL, {
              confirm: async (info) => {
                process.stdout.write(
                  `${info.repo} :: ${info.file}\n  size: ${formatBytes(info.sizeBytes)}\n  license: ${info.license} (${info.licenseUrl})\n`,
                );
                return confirm("Download this file?");
              },
              onProgress: renderProgress(SMALLER_DEEP_MODEL),
            });
            if (pulled.status === "cancelled") {
              process.stdout.write("Cancelled.\n");
              process.exitCode = 1;
              return;
            }
            outcome = await upAll(smallerConfig);
          } else {
            process.stdout.write("Aborting (use --force to start anyway).\n");
            process.exitCode = 1;
            return;
          }
        }

        if (outcome.kind === "ok") {
          for (const result of outcome.results) {
            const verb = result.status === "already-running" ? "already running" : "started";
            process.stdout.write(`${result.role} (${result.name}): ${verb} on port ${result.port} (pid ${result.pid})\n`);
          }
        }
      } catch (err) {
        handleKnownErrors(err);
      }
    });

  program
    .command("down")
    .description("Stop the fast and/or deep model servers")
    .option("--config <path>", "path to reflex.config.json")
    .option("--fast-only", "only stop the fast model server", false)
    .option("--deep-only", "only stop the deep model server", false)
    .action(async (opts: { config?: string; fastOnly: boolean; deepOnly: boolean }) => {
      try {
        const config = loadConfig(opts.config);
        const only: Role[] | undefined = opts.fastOnly ? ["fast"] : opts.deepOnly ? ["deep"] : undefined;
        const results = await downAll(config, only ? { only } : {});
        for (const result of results) {
          process.stdout.write(
            `${result.role} (${result.name}): ${result.stopped ? "stopped" : "was not running"}\n`,
          );
        }
      } catch (err) {
        handleKnownErrors(err);
      }
    });

  program
    .command("status")
    .description("Show whether the model servers are running and healthy")
    .option("--config <path>", "path to reflex.config.json")
    .option("--json", "output machine-readable JSON", false)
    .action(async (opts: { config?: string; json: boolean }) => {
      try {
        const config = loadConfig(opts.config);
        const results = await statusAll(config);
        if (opts.json) {
          process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
          return;
        }
        for (const r of results) {
          const state = r.running ? (r.healthy ? "running (healthy)" : "running (unhealthy)") : "stopped";
          const memory = r.memoryBytes !== undefined ? formatBytes(r.memoryBytes) : "-";
          process.stdout.write(
            `${r.role.padEnd(4)} ${r.name.padEnd(18)} port ${r.port}  pid ${String(r.pid ?? "-").padEnd(8)} mem ${memory.padEnd(10)} ${state}\n`,
          );
        }
      } catch (err) {
        handleKnownErrors(err);
      }
    });
}
