import { Command } from "commander";
import fs from "node:fs";
import { loadConfig, ConfigError } from "../../config.js";
import { parseDecisionSchema, SchemaError } from "../../core/schema.js";
import { decide, DecideError } from "../../core/decide.js";
import { BackendError } from "../../core/backend.js";
import { upAll, serverHandle, OrchestratorError } from "../../runtime/orchestrator.js";
import { UnsupportedPlatformError } from "../../runtime/platform.js";

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function resolveState(opts: { state?: string; stateFile?: string }): Promise<string> {
  if (opts.state !== undefined) return opts.state;
  if (opts.stateFile) return fs.readFileSync(opts.stateFile, "utf8");
  return readStdin();
}

function parseStateText(text: string): string | Record<string, unknown> {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return text;
    }
  }
  return text;
}

export function registerDecideCommand(program: Command): void {
  program
    .command("decide")
    .description("Answer a fixed set of questions about a state, with confidence and escalation")
    .requiredOption("--schema <path>", "path to a decision schema JSON file")
    .option("--state <text>", "state as inline text or JSON")
    .option("--state-file <path>", "path to a file containing the state")
    .option("--config <path>", "path to reflex.config.json")
    .option("--pretty", "print a table instead of JSON", false)
    .action(async (opts: { schema: string; state?: string; stateFile?: string; config?: string; pretty: boolean }) => {
      try {
        const config = loadConfig(opts.config);
        const schema = parseDecisionSchema(JSON.parse(fs.readFileSync(opts.schema, "utf8")));
        const stateText = await resolveState(opts);
        const state = parseStateText(stateText);

        if (config.autostart) {
          await upAll(config);
        }

        const fastHandle = serverHandle(config, "fast");
        const deepHandle = serverHandle(config, "deep");

        const result = await decide({
          fastBaseUrl: fastHandle.baseUrl,
          deepBaseUrl: deepHandle.baseUrl,
          schema,
          state,
          router: config.router,
          fastGeneration: config.fast,
          deepGeneration: config.deep,
        });

        if (opts.pretty) {
          process.stdout.write(
            `${"QUESTION".padEnd(20)} ${"ANSWER".padEnd(15)} ${"CONFIDENCE".padEnd(10)} ${"BY".padEnd(5)} LATENCY\n`,
          );
          for (const r of result.results) {
            const conf = r.confidence === null ? "-" : r.confidence.toFixed(3);
            process.stdout.write(
              `${r.name.padEnd(20)} ${r.answer.padEnd(15)} ${conf.padEnd(10)} ${r.decidedBy.padEnd(5)} ${r.latencyMs}ms\n`,
            );
          }
          process.stdout.write(
            `\nTotal: ${result.totalLatencyMs}ms, escalation rate: ${(result.escalationRate * 100).toFixed(0)}%\n`,
          );
        } else {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        }
      } catch (err) {
        if (
          err instanceof ConfigError ||
          err instanceof SchemaError ||
          err instanceof DecideError ||
          err instanceof BackendError ||
          err instanceof OrchestratorError ||
          err instanceof UnsupportedPlatformError
        ) {
          process.stderr.write(`${err.message}\n`);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
    });
}
