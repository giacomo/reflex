import os from "node:os";
import path from "node:path";
import { TOOL_NAME } from "./constants.js";

function homedir(): string {
  return os.homedir();
}

/** Model weights and downloaded archives. */
export function cacheDir(): string {
  if (process.env["REFLEX_CACHE_DIR"]) return process.env["REFLEX_CACHE_DIR"];
  if (process.env["XDG_CACHE_HOME"]) return path.join(process.env["XDG_CACHE_HOME"], TOOL_NAME);
  if (process.platform === "darwin") return path.join(homedir(), "Library", "Caches", TOOL_NAME);
  if (process.platform === "win32") {
    const base = process.env["LOCALAPPDATA"] ?? path.join(homedir(), "AppData", "Local");
    return path.join(base, TOOL_NAME, "Cache");
  }
  return path.join(homedir(), ".cache", TOOL_NAME);
}

/** Pid files, logs, runtime build lock file. */
export function stateDir(): string {
  if (process.env["REFLEX_STATE_DIR"]) return process.env["REFLEX_STATE_DIR"];
  if (process.env["XDG_STATE_HOME"]) return path.join(process.env["XDG_STATE_HOME"], TOOL_NAME);
  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", TOOL_NAME, "state");
  }
  if (process.platform === "win32") {
    const base = process.env["LOCALAPPDATA"] ?? path.join(homedir(), "AppData", "Local");
    return path.join(base, TOOL_NAME, "State");
  }
  return path.join(homedir(), ".local", "state", TOOL_NAME);
}

/** Built llama.cpp fork checkout + binaries. */
export function runtimeDir(): string {
  return path.join(stateDir(), "runtime");
}

export function modelsDir(): string {
  return path.join(cacheDir(), "models");
}

export function pidFile(name: string): string {
  return path.join(stateDir(), "run", `${name}.pid`);
}

export function logFile(name: string): string {
  return path.join(stateDir(), "logs", `${name}.log`);
}
