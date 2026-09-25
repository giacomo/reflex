import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, ConfigError } from "../../config.js";
import { loadTasks, BenchTaskError } from "../../bench/tasks.js";
import { answerSchema } from "../../core/decide.js";
import { fitTemperature, CalibrationError, type CalibrationExample } from "../../core/calibration.js";
import { upAll, serverHandle, OrchestratorError } from "../../runtime/orchestrator.js";
import { UnsupportedPlatformError } from "../../runtime/platform.js";
import { BackendError } from "../../core/backend.js";

function saveCalibratedTemperature(configPath: string, temperature: number): void {
  const raw = fs.existsSync(configPath)
    ? (JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>)
    : {};
  const router = (raw["router"] as Record<string, unknown> | undefined) ?? {};
  const calibration = (router["calibration"] as Record<string, unknown> | undefined) ?? {};
  raw["router"] = { ...router, calibration: { ...calibration, temperature } };
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(raw, null, 2)}\n`);
}

export function registerCalibrateCommand(program: Command): void {
  program
    .command("calibrate")
    .description("Fit the confidence temperature-scaling factor against labeled tasks and save it")
    .requiredOption("--tasks <path>", "path to a tasks.jsonl file")
    .option("--config <path>", "path to reflex.config.json (also the file calibration is saved to)")
    .action(async (opts: { tasks: string; config?: string }) => {
      try {
        const configPath = opts.config ?? path.join(process.cwd(), "reflex.config.json");
        const config = loadConfig(opts.config);
        const tasks = loadTasks(opts.tasks);

        if (config.autostart) {
          await upAll(config, { only: ["fast"] });
        }
        const fastBaseUrl = serverHandle(config, "fast").baseUrl;

        const examples: CalibrationExample[] = [];
        for (const task of tasks) {
          const result = await answerSchema(fastBaseUrl, task.schema, task.state, config.fast, 5);
          for (const question of task.schema.questions) {
            const answer = result.answers[question.name] ?? "";
            examples.push({
              raw: result.raw,
              content: result.content,
              questionName: question.name,
              correct: answer === task.expected[question.name],
            });
          }
        }

        const fit = fitTemperature(examples);
        saveCalibratedTemperature(configPath, fit.temperature);

        process.stdout.write(
          `Calibrated temperature: ${fit.temperature} (ECE ${fit.ece.toFixed(4)} over ${fit.sampleCount} samples)\n` +
            `Saved to ${configPath}\n`,
        );
      } catch (err) {
        if (
          err instanceof ConfigError ||
          err instanceof BenchTaskError ||
          err instanceof CalibrationError ||
          err instanceof OrchestratorError ||
          err instanceof UnsupportedPlatformError ||
          err instanceof BackendError
        ) {
          process.stderr.write(`${err.message}\n`);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
    });
}
