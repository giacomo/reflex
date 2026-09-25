import { assertSupportedPlatform } from "./platform.js";
import { checkPrerequisites, PrerequisiteError, type PrerequisiteReport } from "./prerequisites.js";
import { buildRuntime, serverBinaryPath, type RuntimeLock, type BuildOptions } from "./build.js";
import {
  startServer,
  stopServer,
  checkHealth,
  waitForHealth,
  type ServerConfig,
  type StartedServer,
} from "./server.js";

/**
 * Capability seam for the model server backend. The only implementation
 * today builds and drives the XHToken/llama.cpp fork, but other backends
 * (MLX, SGLang, ...) could implement the same four operations later.
 */
export interface Runtime {
  ensure(opts?: Partial<BuildOptions>): Promise<RuntimeLock>;
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

  async ensure(opts: Partial<BuildOptions> = {}): Promise<RuntimeLock> {
    assertSupportedPlatform();
    const prereqs = this.checkPrerequisites();
    if (!prereqs.ok) {
      throw new PrerequisiteError(
        `Missing build prerequisites:\n${prereqs.missingInstructions.map((i) => `  - ${i}`).join("\n")}`,
      );
    }
    return buildRuntime({ dir: this.runtimeDir, hasNvcc: prereqs.nvcc, ...opts });
  }

  binaryPath(): string {
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
