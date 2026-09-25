import path from "node:path";
import { assertSupportedPlatform, usesPrebuiltByDefault } from "./platform.js";
import { checkPrerequisites, type PrerequisiteReport } from "./prerequisites.js";
import { buildRuntime, serverBinaryPath } from "./build.js";
import { installPrebuilt } from "./prebuilt.js";
import { readLock, type RuntimeLock } from "./lock.js";
import type { DownloadProgress } from "../models/download.js";
import {
  startServer,
  stopServer,
  checkHealth,
  waitForHealth,
  type ServerConfig,
  type StartedServer,
} from "./server.js";

export interface EnsureOptions {
  force?: boolean;
  /** Source-build log lines (git clone / cmake output). */
  onOutput?: (chunk: string) => void;
  /** Prebuilt archive download progress. */
  onDownloadProgress?: (progress: DownloadProgress) => void;
}

/**
 * Capability seam for the model server backend. The only implementation
 * today builds (or downloads a prebuilt) llama-server, but other backends
 * (MLX, SGLang, ...) could implement the same operations later.
 */
export interface Runtime {
  ensure(opts?: EnsureOptions): Promise<RuntimeLock>;
  binaryPath(): string;
  start(config: ServerConfig): StartedServer;
  stop(pidFile: string): Promise<void>;
  health(baseUrl: string): Promise<boolean>;
  waitUntilHealthy(baseUrl: string, timeoutMs?: number): Promise<void>;
  checkPrerequisites(): PrerequisiteReport;
}

export class LlamaCppRuntime implements Runtime {
  constructor(private readonly runtimeDir: string) {}

  checkPrerequisites(): PrerequisiteReport {
    return checkPrerequisites();
  }

  /**
   * Windows always uses a downloaded prebuilt binary (see prebuilt.ts) since
   * automating an MSVC/clang toolchain isn't attempted. Linux/macOS build
   * the XHToken fork from source by default, but fall back to prebuilt too
   * when no compiler is found -- "if building isn't possible, download an
   * executable" applies everywhere, not just Windows.
   */
  async ensure(opts: EnsureOptions = {}): Promise<RuntimeLock> {
    assertSupportedPlatform();

    const usePrebuilt = usesPrebuiltByDefault() || !this.checkPrerequisites().ok;
    if (usePrebuilt) {
      return installPrebuilt(this.runtimeDir, {
        ...(opts.force !== undefined ? { force: opts.force } : {}),
        ...(opts.onDownloadProgress ? { onProgress: opts.onDownloadProgress } : {}),
      });
    }

    const prereqs = this.checkPrerequisites();
    return buildRuntime({
      dir: this.runtimeDir,
      hasNvcc: prereqs.nvcc,
      ...(opts.force !== undefined ? { force: opts.force } : {}),
      ...(opts.onOutput ? { onOutput: opts.onOutput } : {}),
    });
  }

  binaryPath(): string {
    const lock = readLock(this.runtimeDir);
    if (lock) return lock.binaryPath;
    if (usesPrebuiltByDefault()) {
      const name = process.platform === "win32" ? "llama-server.exe" : "llama-server";
      return path.join(this.runtimeDir, "prebuilt", name);
    }
    return serverBinaryPath(this.runtimeDir);
  }

  start(config: ServerConfig): StartedServer {
    return startServer(config);
  }

  async stop(pidFile: string): Promise<void> {
    await stopServer(pidFile);
  }

  async health(baseUrl: string): Promise<boolean> {
    return checkHealth(baseUrl);
  }

  async waitUntilHealthy(baseUrl: string, timeoutMs?: number): Promise<void> {
    await waitForHealth(baseUrl, timeoutMs !== undefined ? { timeoutMs } : {});
  }
}
