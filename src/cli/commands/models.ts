import { Command } from "commander";
import {
  pullModel,
  listLocalModels,
  removeModel,
  ModelManagerError,
} from "../../models/manager.js";
import { listRegistryModels } from "../../models/registry.js";
import { formatBytes } from "../format.js";
import { confirm } from "../prompt.js";
import { renderProgress } from "../progress.js";

export function registerModelsCommand(program: Command): void {
  const models = program.command("models").description("Manage local model weights");

  models
    .command("list")
    .description("List locally pulled models and known registry entries")
    .action(() => {
      const local = new Map(listLocalModels().map((m) => [m.name, m]));
      const rows = listRegistryModels().map(({ name, model }) => {
        const manifest = local.get(name);
        return {
          name,
          role: model.role,
          status: manifest ? "pulled" : "not pulled",
          size: manifest ? formatBytes(manifest.sizeBytes) : "-",
          license: model.license,
        };
      });
      const widths = {
        name: Math.max(4, ...rows.map((r) => r.name.length)),
        role: Math.max(4, ...rows.map((r) => r.role.length)),
        status: Math.max(6, ...rows.map((r) => r.status.length)),
        size: Math.max(4, ...rows.map((r) => r.size.length)),
      };
      const header = `${"NAME".padEnd(widths.name)}  ${"ROLE".padEnd(widths.role)}  ${"STATUS".padEnd(widths.status)}  ${"SIZE".padEnd(widths.size)}  LICENSE`;
      process.stdout.write(`${header}\n`);
      for (const row of rows) {
        process.stdout.write(
          `${row.name.padEnd(widths.name)}  ${row.role.padEnd(widths.role)}  ${row.status.padEnd(widths.status)}  ${row.size.padEnd(widths.size)}  ${row.license}\n`,
        );
      }
    });

  models
    .command("pull <name>")
    .description("Download a model from the registry (or an explicit repo with --unsafe-repo)")
    .option("--yes", "skip the confirmation prompt", false)
    .option("--unsafe-repo <repo>", "pull an arbitrary Hugging Face repo instead of a registry entry")
    .action(async (name: string, opts: { yes: boolean; unsafeRepo?: string }) => {
      try {
        const result = await pullModel(name, {
          yes: opts.yes,
          ...(opts.unsafeRepo ? { unsafeRepo: opts.unsafeRepo } : {}),
          confirm: async (info) => {
            process.stdout.write(
              `${info.repo} :: ${info.file}\n  size: ${formatBytes(info.sizeBytes)}\n  license: ${info.license} (${info.licenseUrl})\n`,
            );
            return confirm("Download this file?");
          },
          onProgress: renderProgress(name),
        });
        if (result.status === "already-present") {
          process.stdout.write(`${name} is already pulled (${result.manifest.file}).\n`);
        } else if (result.status === "cancelled") {
          process.stdout.write("Cancelled.\n");
        } else {
          process.stdout.write(`Pulled ${name}: ${result.manifest.file}\n`);
        }
      } catch (err) {
        if (err instanceof ModelManagerError) {
          process.stderr.write(`${err.message}\n`);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
    });

  models
    .command("rm <name>")
    .description("Remove a locally pulled model")
    .action((name: string) => {
      const removed = removeModel(name);
      process.stdout.write(removed ? `Removed ${name}.\n` : `${name} was not pulled.\n`);
    });
}
