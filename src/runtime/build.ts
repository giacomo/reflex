import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { defaultExec, type Exec } from "./exec.js";
import { detectGpuBackend } from "./platform.js";
import { readLock, writeLock, type SourceBuildLock } from "./lock.js";

export class BuildError extends Error {}

export const FORK_REPO_URL = "https://github.com/XHToken/llama.cpp";
export const FORK_BRANCH = "master";

export interface BuildOptions {
  dir: string;
  repoUrl?: string;
  branch?: string;
  hasNvcc?: boolean;
  jobs?: number;
  force?: boolean;
  exec?: Exec;
  onOutput?: (chunk: string) => void;
}

/** Only meaningful for the from-source build; on Windows the prebuilt path is used instead. */
export function serverBinaryPath(dir: string): string {
  return path.join(dir, "build", "bin", "llama-server");
}

/**
 * Clones (if needed) and builds the XHToken/llama.cpp fork, producing
 * `build/bin/llama-server`. Idempotent: if a lock file and the binary it
 * points at both already exist, the build is skipped entirely (unless
 * `force` is set), so a second `reflex setup` run doesn't rebuild.
 */
export async function buildRuntime(opts: BuildOptions): Promise<SourceBuildLock> {
  const exec = opts.exec ?? defaultExec;
  const repoUrl = opts.repoUrl ?? FORK_REPO_URL;
  const branch = opts.branch ?? FORK_BRANCH;
  const binaryPath = serverBinaryPath(opts.dir);

  if (!opts.force) {
    const existing = readLock(opts.dir);
    if (existing?.source === "source" && fs.existsSync(binaryPath)) {
      return existing;
    }
  }

  const gitDir = path.join(opts.dir, ".git");
  if (!fs.existsSync(gitDir)) {
    fs.mkdirSync(opts.dir, { recursive: true });
    const clone = await exec(
      "git",
      ["clone", "--depth", "1", "--branch", branch, repoUrl, "."],
      { cwd: opts.dir, ...(opts.onOutput ? { onOutput: opts.onOutput } : {}) },
    );
    if (clone.status !== 0) {
      throw new BuildError(
        `git clone of ${repoUrl} (branch ${branch}) failed with exit code ${clone.status}. ` +
          `${clone.stderr.trim() || "See the output above for details."}`,
      );
    }
  }

  const { backend, cmakeFlags } = detectGpuBackend(opts.hasNvcc ?? false);
  const configure = await exec("cmake", ["-B", "build", ...cmakeFlags], {
    cwd: opts.dir,
    ...(opts.onOutput ? { onOutput: opts.onOutput } : {}),
  });
  if (configure.status !== 0) {
    throw new BuildError(
      `cmake configure failed with exit code ${configure.status}. ${configure.stderr.trim() || "See the output above for details."}`,
    );
  }

  const jobs = opts.jobs ?? Math.max(1, Math.min(os.cpus().length, 8));
  const build = await exec(
    "cmake",
    ["--build", "build", "--config", "Release", "-j", String(jobs), "--target", "llama-server"],
    { cwd: opts.dir, ...(opts.onOutput ? { onOutput: opts.onOutput } : {}) },
  );
  if (build.status !== 0) {
    throw new BuildError(
      `cmake build failed with exit code ${build.status}. ${build.stderr.trim() || "See the output above for details."}`,
    );
  }

  if (!fs.existsSync(binaryPath)) {
    throw new BuildError(
      `Build finished but ${binaryPath} was not produced. Check the build output above.`,
    );
  }

  const revParse = await exec("git", ["rev-parse", "HEAD"], { cwd: opts.dir });
  const commitHash = revParse.stdout.trim() || "unknown";

  const lock: SourceBuildLock = {
    source: "source",
    repoUrl,
    branch,
    commitHash,
    backend,
    builtAt: new Date().toISOString(),
    binaryPath,
  };
  writeLock(opts.dir, lock);
  return lock;
}
