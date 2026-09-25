import { Command } from "commander";
import { loadConfig, ConfigError } from "../../config.js";
import { loadTasks, BenchTaskError } from "../../bench/tasks.js";
import { runBench } from "../../bench/runner.js";
import { upAll, serverHandle, OrchestratorError } from "../../runtime/orchestrator.js";
import { UnsupportedPlatformError } from "../../runtime/platform.js";
import { BackendError } from "../../core/backend.js";
import { DecideError } from "../../core/decide.js";

export function registerBenchCommand(program: Command): void {
  program
    .command("bench")
    .description("Measure accuracy, latency, escalation rate, and ECE across fast-only/deep-only/combined")
    .requiredOption("--tasks <path>", "path to a tasks.jsonl file")
    .option("--config <path>", "path to reflex.config.json")
    .option("--pretty", "print a table instead of JSON", false)
    .action(async (opts: { tasks: string; config?: string; pretty: boolean }) => {
      try {
        const config = loadConfig(opts.config);
        const tasks = loadTasks(opts.tasks);

        if (config.autostart) {
          await upAll(config);
        }

        const fastHandle = serverHandle(config, "fast");
        const deepHandle = serverHandle(config, "deep");

        const report = await runBench(tasks, {
          fastBaseUrl: fastHandle.baseUrl,
          deepBaseUrl: deepHandle.baseUrl,
          router: config.router,
          fastGeneration: config.fast,
          deepGeneration: config.deep,
        });

        if (opts.pretty) {
          process.stdout.write(
            `${"MODE".padEnd(12)} ${"ACC".padEnd(6)} ${"P50".padEnd(8)} ${"P95".padEnd(8)} ${"ESC%".padEnd(6)} ${"ECE".padEnd(6)} SAMPLES\n`,
          );
          for (const m of report.modes) {
            process.stdout.write(
              `${m.mode.padEnd(12)} ${m.accuracy.toFixed(2).padEnd(6)} ${`${m.latencyP50Ms.toFixed(0)}ms`.padEnd(8)} ` +
                `${`${m.latencyP95Ms.toFixed(0)}ms`.padEnd(8)} ${(m.escalationRate * 100).toFixed(0).padEnd(6)} ` +
                `${(m.ece ?? -1).toFixed(3).padEnd(6)} ${m.sampleCount}\n`,
            );
          }
        } else {
          process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        }
      } catch (err) {
        if (
          err instanceof ConfigError ||
          err instanceof BenchTaskError ||
          err instanceof OrchestratorError ||
          err instanceof UnsupportedPlatformError ||
          err instanceof BackendError ||
          err instanceof DecideError
        ) {
          process.stderr.write(`${err.message}\n`);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
    });
}
