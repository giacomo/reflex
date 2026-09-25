import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { GenerationParams } from "../config.js";

export class ServerError extends Error {}

export interface ServerConfig {
  binaryPath: string;
  modelPath: string;
  host: string;
  port: number;
  contextSize: number;
  gpuLayers: number | "auto" | "all";
  threads: number;
  generation: GenerationParams;
  /**
   * Each reflex-managed server is single-purpose (fast = never thinks, deep
   * = always thinks), so the thinking-mode toggle is a fixed startup flag
   * rather than something sent per HTTP request.
   */
  enableThinking: boolean;
  logFile: string;
  pidFile: string;
}

/**
 * Builds llama-server's argv. Flag names and semantics are taken from the
 * XHToken/llama.cpp fork's `tools/server/README.md` (`-m`, `-c`, `-ngl`,
 * `-t`, `--host`, `--port`, `--jinja`, `--chat-template-kwargs`, sampling
 * flags): none of these are guessed. Per-request sampling overrides (used
 * when escalating a single question) are still sent with each HTTP request.
 */
export function buildServerArgs(config: ServerConfig): string[] {
  const args = [
    "-m", config.modelPath,
    "-c", String(config.contextSize),
    "-ngl", String(config.gpuLayers),
    "-t", String(config.threads),
    "--host", config.host,
    "--port", String(config.port),
    "--jinja",
    "--chat-template-kwargs", JSON.stringify({ enable_thinking: config.enableThinking }),
    "--temp", String(config.generation.temperature),
    "--top-p", String(config.generation.topP),
    "--top-k", String(config.generation.topK),
    "--min-p", String(config.generation.minP),
  ];
  if (config.generation.repetitionPenalty !== undefined) {
    args.push("--repeat-penalty", String(config.generation.repetitionPenalty));
  }
  return args;
}

export interface StartedServer {
  process: ChildProcess;
  pid: number;
}

export function startServer(config: ServerConfig): StartedServer {
  if (!fs.existsSync(config.binaryPath)) {
    throw new ServerError(
      `llama-server binary not found at ${config.binaryPath}. Run "reflex setup" first.`,
    );
  }
  if (!fs.existsSync(config.modelPath)) {
    throw new ServerError(`Model file not found at ${config.modelPath}. Run "reflex models pull" first.`);
  }

  fs.mkdirSync(path.dirname(config.logFile), { recursive: true });
  fs.mkdirSync(path.dirname(config.pidFile), { recursive: true });

  // The child must write its own stdout/stderr directly to the log file via
  // a raw fd, not through a `.pipe()` in this process: a piped stream only
  // keeps flowing while this process is alive to relay it, which defeats
  // `detached` (a backgrounded llama-server would eventually block writing
  // to an unread pipe once the CLI invocation that started it exits).
  // Matches Node's own documented pattern for a detached, file-logging
  // child: the fd is intentionally left open rather than closed here, since
  // this process (a short-lived CLI invocation) exits shortly after anyway.
  const logFd = fs.openSync(config.logFile, "a");
  const child = spawn(config.binaryPath, buildServerArgs(config), {
    stdio: ["ignore", logFd, logFd],
    detached: true,
  });

  if (!child.pid) {
    throw new ServerError(`Failed to spawn ${config.binaryPath}.`);
  }
  fs.writeFileSync(config.pidFile, String(child.pid));
  child.unref();

  return { process: child, pid: child.pid };
}

export interface HealthCheckOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

/** Polls GET /health until it returns 200, per the fork's documented health endpoint contract. */
export async function waitForHealth(
  baseUrl: string,
  opts: HealthCheckOptions = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const intervalMs = opts.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.status === 200) return;
    } catch {
      // Server not accepting connections yet; keep polling.
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new ServerError(`Server at ${baseUrl} did not become healthy within ${timeoutMs}ms.`);
}

export async function checkHealth(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`);
    return res.status === 200;
  } catch {
    return false;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readPidFile(pidFile: string): number | undefined {
  if (!fs.existsSync(pidFile)) return undefined;
  const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
  return Number.isFinite(pid) ? pid : undefined;
}

/** Sends SIGTERM, escalating to SIGKILL if the process is still alive after `graceMs`. */
export async function stopServer(pidFile: string, graceMs = 5000): Promise<void> {
  const pid = readPidFile(pidFile);
  if (pid === undefined || !isProcessAlive(pid)) {
    fs.rmSync(pidFile, { force: true });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    fs.rmSync(pidFile, { force: true });
    return;
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && isProcessAlive(pid)) {
    await new Promise((r) => setTimeout(r, 200));
  }
  if (isProcessAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  fs.rmSync(pidFile, { force: true });
}
