#!/usr/bin/env node
import { Command } from "commander";
import { TOOL_NAME } from "../constants.js";
import { registerModelsCommand } from "./commands/models.js";

const VERSION = "0.1.0";

const program = new Command();
program
  .name(TOOL_NAME)
  .description("Local decision layer for agents and workflows.")
  .version(VERSION);

registerModelsCommand(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
