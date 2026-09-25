import { Command } from "commander";
import { loadConfig, ConfigError } from "../../config.js";
import { runtimeDir } from "../../paths.js";
import { LlamaCppRuntime } from "../../runtime/runtime.js";
import { assertSupportedPlatform, UnsupportedPlatformError, usesPrebuiltByDefault } from "../../runtime/platform.js";
import { BuildError } from "../../runtime/build.js";
import { PrebuiltError } from "../../runtime/prebuilt.js";
import { pullModel, ModelManagerError } from "../../models/manager.js";
import { formatBytes } from "../format.js";
import { confirm } from "../prompt.js";
import { renderProgress } from "../progress.js";
import { runDoctor } from "./doctor.js";

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("Check prerequisites, set up the runtime, pull both models, then run doctor")
    .option("--config <path>", "path to reflex.config.json")
    .option("--yes", "skip download confirmation prompts", false)
    .option(
      "--force-runtime",
      "redo runtime setup even if one is already in place (e.g. to pick up a newly detected GPU)",
      false,
    )
    .action(async (opts: { config?: string; yes: boolean; forceRuntime: boolean }) => {
      try {
        const config = loadConfig(opts.config);
        assertSupportedPlatform();
        const runtime = new LlamaCppRuntime(runtimeDir());

        const prereqs = runtime.checkPrerequisites();
        const willBuildFromSource = !usesPrebuiltByDefault() && prereqs.ok;
        if (willBuildFromSource) {
          process.stdout.write("Building the llama.cpp runtime from source (this can take a few minutes)...\n");
        } else if (usesPrebuiltByDefault()) {
          process.stdout.write("Downloading a prebuilt llama-server (ggml-org/llama.cpp release)...\n");
        } else {
          process.stdout.write(
            "No C++ compiler found; downloading a prebuilt llama-server instead of building from source...\n",
          );
        }

        const lock = await runtime.ensure({
          force: opts.forceRuntime,
          onOutput: (chunk) => process.stdout.write(chunk),
          onDownloadProgress: renderProgress("runtime"),
        });
        process.stdout.write(
          lock.source === "source"
            ? `Runtime ready: built from source, ${lock.backend} backend, commit ${lock.commitHash.slice(0, 12)}\n`
            : `Runtime ready: prebuilt ${lock.repo}@${lock.tag}, ${lock.backend} backend (${lock.assetName})\n`,
        );

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
          err instanceof UnsupportedPlatformError ||
          err instanceof BuildError ||
          err instanceof PrebuiltError ||
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
