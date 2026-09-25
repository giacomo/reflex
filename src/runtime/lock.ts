import fs from "node:fs";
import path from "node:path";
import type { GpuBackend } from "./platform.js";

export interface SourceBuildLock {
  source: "source";
  repoUrl: string;
  branch: string;
  commitHash: string;
  backend: GpuBackend;
  builtAt: string;
  binaryPath: string;
}

export interface PrebuiltLock {
  source: "prebuilt";
  repo: string;
  tag: string;
  assetName: string;
  builtAt: string;
  binaryPath: string;
}

export type RuntimeLock = SourceBuildLock | PrebuiltLock;

export function lockPath(dir: string): string {
  return path.join(dir, "lock.json");
}

export function readLock(dir: string): RuntimeLock | undefined {
  const file = lockPath(dir);
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8")) as RuntimeLock;
}

export function writeLock(dir: string, lock: RuntimeLock): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(lockPath(dir), JSON.stringify(lock, null, 2));
}
