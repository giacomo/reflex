import fs from "node:fs";
import path from "node:path";
import type { Runtime } from "../../src/runtime/runtime.js";
import type { ServerConfig, StartedServer } from "../../src/runtime/server.js";
import type { PrerequisiteReport } from "../../src/runtime/prerequisites.js";
import type { RuntimeLock } from "../../src/runtime/build.js";

export interface FakeRuntimeOptions {
  /** pid to report for every started/checked server; defaults to this test process's own pid. */
  pid?: number;
  /** health() return value for any baseUrl not explicitly listed in healthyUrls. */
  defaultHealthy?: boolean;
  healthyUrls?: Set<string>;
  failHealthCheckFor?: Set<string>;
}

export interface FakeRuntime extends Runtime {
  startCalls: ServerConfig[];
  stopCalls: string[];
}

export function createFakeRuntime(opts: FakeRuntimeOptions = {}): FakeRuntime {
  const pid = opts.pid ?? process.pid;
  const startCalls: ServerConfig[] = [];
  const stopCalls: string[] = [];
  const startedUrls = new Set<string>();

  return {
    startCalls,
    stopCalls,
    checkPrerequisites(): PrerequisiteReport {
      return {
        git: true,
        cmake: true,
        compiler: true,
        compilerName: "cc",
        nvcc: false,
        ok: true,
        missingInstructions: [],
      };
    },
    async ensure(): Promise<RuntimeLock> {
      return {
        repoUrl: "fake",
        branch: "master",
        commitHash: "fake",
        backend: "cpu",
        builtAt: new Date().toISOString(),
        binaryPath: "/fake/llama-server",
      };
    },
    binaryPath(): string {
      return "/fake/llama-server";
    },
    start(config: ServerConfig): StartedServer {
      startCalls.push(config);
      fs.mkdirSync(path.dirname(config.pidFile), { recursive: true });
      fs.writeFileSync(config.pidFile, String(pid));
      startedUrls.add(`http://${config.host}:${config.port}`);
      return { process: {} as StartedServer["process"], pid };
    },
    async stop(pidFile: string): Promise<void> {
      stopCalls.push(pidFile);
      fs.rmSync(pidFile, { force: true });
    },
    async health(baseUrl: string): Promise<boolean> {
      // A server this fake just "started" is always healthy, regardless of
      // whatever defaultHealthy/failHealthCheckFor simulate for a
      // pre-existing (possibly stale) pid file.
      if (startedUrls.has(baseUrl)) return true;
      if (opts.failHealthCheckFor?.has(baseUrl)) return false;
      if (opts.healthyUrls?.has(baseUrl)) return true;
      return opts.defaultHealthy ?? true;
    },
    async waitUntilHealthy(baseUrl: string): Promise<void> {
      const healthy = await this.health(baseUrl);
      if (!healthy) throw new Error(`fake runtime: ${baseUrl} never became healthy`);
    },
  };
}
