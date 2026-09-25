import { Command } from "commander";
import { loadConfig, ConfigError } from "../../config.js";
import { createServer, ServerBindError } from "../../server/http.js";
import { upAll, OrchestratorError } from "../../runtime/orchestrator.js";
import { UnsupportedPlatformError } from "../../runtime/platform.js";

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Run a localhost-only HTTP server: POST /decide, GET /health, and a GET / test page")
    .option("--config <path>", "path to reflex.config.json")
    .option("--port <port>", "override server.port from config")
    .action(async (opts: { config?: string; port?: string }) => {
      try {
        const config = loadConfig(opts.config);
        const port = opts.port ? Number(opts.port) : config.server.port;

        if (config.autostart) {
          process.stdout.write("Starting model servers...\n");
          await upAll(config);
        }

        const server = createServer(config);
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(port, config.server.host, () => {
            server.removeListener("error", reject);
            resolve();
          });
        });
        const base = `http://${config.server.host}:${port}`;
        process.stdout.write(`reflex serve listening on ${base}\n`);
        process.stdout.write(`Try it in a browser: ${base}/\n`);

        const shutdown = () => {
          process.stdout.write("\nShutting down...\n");
          server.close(() => process.exit(0));
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
      } catch (err) {
        if (
          err instanceof ConfigError ||
          err instanceof ServerBindError ||
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
