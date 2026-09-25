import type { ReflexConfig } from "../config.js";
import { pidFile as pidFilePath, logFile as logFilePath, runtimeDir } from "../paths.js";
import { getLocalModelPath, readManifest } from "../models/manager.js";
import { LlamaCppRuntime, type Runtime } from "./runtime.js";
import { readPidFile, isProcessAlive } from "./server.js";
import { checkMemory, type MemoryCheck, type MemoryRequirement } from "./memory.js";
import { isPortFree } from "./ports.js";

export class OrchestratorError extends Error {}

export type Role = "fast" | "deep";
export const ROLES: readonly Role[] = ["fast", "deep"];

export interface ServerHandle {
  role: Role;
  name: string;
  host: string;
  port: number;
  pidFile: string;
  logFile: string;
  baseUrl: string;
}

export function serverHandle(config: ReflexConfig, role: Role): ServerHandle {
  const host = "127.0.0.1";
  const port = config.ports[role];
  return {
    role,
    name: config.models[role],
    host,
    port,
    pidFile: pidFilePath(role),
    logFile: logFilePath(role),
    baseUrl: `http://${host}:${port}`,
  };
}

function requirementFor(role: Role, name: string): MemoryRequirement {
  const manifest = readManifest(name);
  if (!manifest) {
    throw new OrchestratorError(
      `Model "${name}" (${role}) is not pulled yet. Run "reflex models pull ${name}".`,
    );
  }
  return {
    role,
    name,
    requiredBytes: Math.ceil(manifest.sizeBytes * manifest.minMemoryBytesMultiplier),
  };
}

export interface UpOptions {
  only?: readonly Role[];
  runtime?: Runtime;
  /** Skip the memory check (or proceed despite it failing). */
  force?: boolean;
  healthTimeoutMs?: number;
  /** Overrides the free-memory reading used by the pre-flight check; mainly for tests. */
  availableBytes?: number;
}

export interface UpResultItem {
  role: Role;
  name: string;
  port: number;
  pid: number;
  status: "already-running" | "started";
}

export type UpOutcome =
  | { kind: "ok"; results: UpResultItem[] }
  | { kind: "insufficient-memory"; memory: MemoryCheck };

async function alreadyRunning(handle: ServerHandle, runtime: Runtime): Promise<number | undefined> {
  const pid = readPidFile(handle.pidFile);
  if (pid === undefined || !isProcessAlive(pid)) return undefined;
  return (await runtime.health(handle.baseUrl)) ? pid : undefined;
}

export async function upAll(config: ReflexConfig, opts: UpOptions = {}): Promise<UpOutcome> {
  const roles = opts.only ?? ROLES;
  const runtime = opts.runtime ?? new LlamaCppRuntime(runtimeDir());
  const handles = roles.map((role) => serverHandle(config, role));

  const alreadyUp = new Map<Role, number>();
  const toStart: ServerHandle[] = [];
  for (const handle of handles) {
    const pid = await alreadyRunning(handle, runtime);
    if (pid !== undefined) alreadyUp.set(handle.role, pid);
    else toStart.push(handle);
  }

  if (!opts.force && toStart.length > 0) {
    const requirements = toStart.map((h) => requirementFor(h.role, h.name));
    const memory = checkMemory(requirements, opts.availableBytes);
    if (!memory.sufficient) {
      return { kind: "insufficient-memory", memory };
    }
  }

  const results: UpResultItem[] = [];
  for (const [role, pid] of alreadyUp) {
    const handle = handles.find((h) => h.role === role)!;
    results.push({ role, name: handle.name, port: handle.port, pid, status: "already-running" });
  }

  for (const handle of toStart) {
    const modelPath = getLocalModelPath(handle.name);
    if (!modelPath) {
      throw new OrchestratorError(
        `Model "${handle.name}" (${handle.role}) is not pulled yet. Run "reflex models pull ${handle.name}".`,
      );
    }
    if (!(await isPortFree(handle.port, handle.host))) {
      throw new OrchestratorError(
        `Port ${handle.port} (${handle.role} model) is already in use by another process. ` +
          `Set a different port in reflex.config.json under "ports.${handle.role}".`,
      );
    }

    const binaryPath =
      handle.role === "fast" && config.runtime.fast.binary
        ? config.runtime.fast.binary
        : handle.role === "deep" && config.runtime.deep.binary
          ? config.runtime.deep.binary
          : runtime.binaryPath();

    const started = runtime.start({
      binaryPath,
      modelPath,
      host: handle.host,
      port: handle.port,
      contextSize: config.runtime.contextSize[handle.role],
      gpuLayers: config.runtime.gpuLayers,
      threads: config.runtime.threads,
      generation: config[handle.role],
      enableThinking: handle.role === "deep",
      logFile: handle.logFile,
      pidFile: handle.pidFile,
    });

    try {
      await runtime.waitUntilHealthy(handle.baseUrl, opts.healthTimeoutMs);
    } catch (err) {
      await runtime.stop(handle.pidFile);
      throw new OrchestratorError(
        `${handle.role} model server (${handle.name}) failed to become healthy: ${(err as Error).message} ` +
          `See ${handle.logFile} for details.`,
      );
    }

    results.push({
      role: handle.role,
      name: handle.name,
      port: handle.port,
      pid: started.pid,
      status: "started",
    });
  }

  return { kind: "ok", results };
}

export interface DownResultItem {
  role: Role;
  name: string;
  stopped: boolean;
}

export async function downAll(
  config: ReflexConfig,
  opts: { only?: readonly Role[]; runtime?: Runtime } = {},
): Promise<DownResultItem[]> {
  const roles = opts.only ?? ROLES;
  const runtime = opts.runtime ?? new LlamaCppRuntime(runtimeDir());
  const results: DownResultItem[] = [];
  for (const role of roles) {
    const handle = serverHandle(config, role);
    const pid = readPidFile(handle.pidFile);
    const wasRunning = pid !== undefined && isProcessAlive(pid);
    await runtime.stop(handle.pidFile);
    results.push({ role, name: handle.name, stopped: wasRunning });
  }
  return results;
}

export interface StatusResultItem {
  role: Role;
  name: string;
  port: number;
  pid: number | undefined;
  running: boolean;
  healthy: boolean;
}

export async function statusAll(
  config: ReflexConfig,
  opts: { only?: readonly Role[]; runtime?: Runtime } = {},
): Promise<StatusResultItem[]> {
  const roles = opts.only ?? ROLES;
  const runtime = opts.runtime ?? new LlamaCppRuntime(runtimeDir());
  const results: StatusResultItem[] = [];
  for (const role of roles) {
    const handle = serverHandle(config, role);
    const pid = readPidFile(handle.pidFile);
    const running = pid !== undefined && isProcessAlive(pid);
    const healthy = running && (await runtime.health(handle.baseUrl));
    results.push({ role, name: handle.name, port: handle.port, pid, running, healthy });
  }
  return results;
}
