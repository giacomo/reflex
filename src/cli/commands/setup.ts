import { Command } from "commander";
import { loadConfig, ConfigError } from "../../config.js";
import { runtimeDir } from "../../paths.js";
import { LlamaCppRuntime } from "../../runtime/runtime.js";
import { PrerequisiteError } from "../../runtime/prerequisites.js";
import { UnsupportedPlatformError } from "../../runtime/platform.js";
import { BuildError } from "../../runtime/build.js";
import { pullModel, ModelManagerError } from "../../models/manager.js";
import { formatBytes } from "../format.js";
import { confirm } from "../prompt.js";
import { renderProgress } from "../progress.js";
import { runDoctor } from "./doctor.js";

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("Check prerequisites, build the runtime, pull both models, then run doctor")
    .option("--config <path>", "path to reflex.config.json")
    .option("--yes", "skip download confirmation prompts", false)
    .action(async (opts: { config?: string; yes: boolean }) => {
      try {
        const config = loadConfig(opts.config);
        const runtime = new LlamaCppRuntime(runtimeDir());

        process.stdout.write("Checking prerequisites...\n");
        const prereqs = runtime.checkPrerequisites();
        if (!prereqs.ok) {
          process.stderr.write("Missing build prerequisites:\n");
          for (const line of prereqs.missingInstructions) process.stderr.write(`  - ${line}\n`);
          process.exitCode = 1;
          return;
        }

        process.stdout.write("Building the llama.cpp runtime (this can take a few minutes)...\n");
        const lock = await runtime.ensure({
          onOutput: (chunk) => process.stdout.write(chunk),
        });
        process.stdout.write(`Runtime ready: ${lock.backend} backend, commit ${lock.commitHash.slice(0, 12)}\n`);

        for (const name of [config.models.fast, config.models.deep]) {
          const result = await pullModel(name, {
            yes: opts.yes,
            confirm: async (info) => {
              process.stdout.write(
                `${info.repo} :: ${info.file}\n  size: ${formatBytes(info.sizeBytes)}\n  license: ${info.license} (${info.licenseUrl})\n`,
              );
              return confirm("Download this file?");
            },
            onProgress: renderProgress(name),
          });
          if (result.status === "already-present") {
            process.stdout.write(`${name}: already pulled (${result.manifest.file})\n`);
          } else if (result.status === "cancelled") {
            process.stdout.write(`${name}: download cancelled; setup incomplete.\n`);
            process.exitCode = 1;
            return;
          } else {
            process.stdout.write(`${name}: pulled ${result.manifest.file}\n`);
          }
        }

        process.stdout.write("\nRunning doctor...\n\n");
        await runDoctor(config);
      } catch (err) {
        if (
          err instanceof ConfigError ||
          err instanceof PrerequisiteError ||
          err instanceof UnsupportedPlatformError ||
          err instanceof BuildError ||
          err instanceof ModelManagerError
        ) {
          process.stderr.write(`${err.message}\n`);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
    });
}
