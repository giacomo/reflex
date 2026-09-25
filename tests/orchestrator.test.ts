import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConfigSchema, type ReflexConfig } from "../src/config.js";
import { modelsDir, stateDir } from "../src/paths.js";
import { upAll, downAll, statusAll, OrchestratorError } from "../src/runtime/orchestrator.js";
import { createFakeRuntime } from "./helpers/fake-runtime.js";
import type { ModelManifest } from "../src/models/manager.js";

function writeFakeManifest(name: string, overrides: Partial<ModelManifest> = {}): void {
  const dir = path.join(modelsDir(), name);
  fs.mkdirSync(dir, { recursive: true });
  const file = overrides.file ?? "model.gguf";
  fs.writeFileSync(path.join(dir, file), "fake gguf bytes");
  const manifest: ModelManifest = {
    name,
    repo: "acme/test",
    file,
    sizeBytes: 1000,
    sha256: undefined,
    license: "Apache-2.0",
    licenseUrl: "https://example.com",
    role: "fast",
    requiresRuntime: "any",
    minMemoryBytesMultiplier: 1.5,
    pulledAt: new Date().toISOString(),
    ...overrides,
  };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

function testConfig(overrides: Record<string, unknown> = {}): ReflexConfig {
  return ConfigSchema.parse({
    models: { fast: "fast-model", deep: "deep-model" },
    ports: { fast: 18081, deep: 18082 },
    ...overrides,
  });
}

describe("orchestrator", () => {
  let cacheDir: string;
  let stateDirPath: string;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "reflex-orch-cache-"));
    stateDirPath = fs.mkdtempSync(path.join(os.tmpdir(), "reflex-orch-state-"));
    process.env["REFLEX_CACHE_DIR"] = cacheDir;
    process.env["REFLEX_STATE_DIR"] = stateDirPath;
  });

  afterEach(() => {
    delete process.env["REFLEX_CACHE_DIR"];
    delete process.env["REFLEX_STATE_DIR"];
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(stateDirPath, { recursive: true, force: true });
  });

  it("throws a clear error when a configured model hasn't been pulled", async () => {
    const config = testConfig();
    const runtime = createFakeRuntime();
    await expect(upAll(config, { only: ["fast"], runtime })).rejects.toThrow(OrchestratorError);
  });

  it("reports insufficient memory instead of starting anything", async () => {
    writeFakeManifest("fast-model", { role: "fast", sizeBytes: 1_000_000_000 });
    const config = testConfig();
    const runtime = createFakeRuntime();
    const outcome = await upAll(config, {
      only: ["fast"],
      runtime,
      availableBytes: 100,
    });
    expect(outcome.kind).toBe("insufficient-memory");
    expect(runtime.startCalls).toHaveLength(0);
  });

  it("starts a model that isn't running yet and waits for health", async () => {
    writeFakeManifest("fast-model", { role: "fast" });
    const config = testConfig();
    const runtime = createFakeRuntime();

    const outcome = await upAll(config, { only: ["fast"], runtime, force: true });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") throw new Error("unreachable");
    expect(outcome.results).toEqual([
      { role: "fast", name: "fast-model", port: 18081, pid: process.pid, status: "started" },
    ]);
    expect(runtime.startCalls).toHaveLength(1);
    expect(runtime.startCalls[0]?.modelPath).toContain("model.gguf");
  });

  it("detects an already-running, healthy server and does not start it again", async () => {
    writeFakeManifest("fast-model", { role: "fast" });
    const config = testConfig();
    const pidFile = path.join(stateDir(), "run", "fast.pid");
    fs.mkdirSync(path.dirname(pidFile), { recursive: true });
    fs.writeFileSync(pidFile, String(process.pid));

    const runtime = createFakeRuntime({ defaultHealthy: true });
    const outcome = await upAll(config, { only: ["fast"], runtime, force: true });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") throw new Error("unreachable");
    expect(outcome.results[0]?.status).toBe("already-running");
    expect(runtime.startCalls).toHaveLength(0);
  });

  it("restarts when the pid file exists but the process isn't actually healthy", async () => {
    writeFakeManifest("fast-model", { role: "fast" });
    const config = testConfig();
    const pidFile = path.join(stateDir(), "run", "fast.pid");
    fs.mkdirSync(path.dirname(pidFile), { recursive: true });
    fs.writeFileSync(pidFile, String(process.pid));

    const runtime = createFakeRuntime({ defaultHealthy: false });
    const outcome = await upAll(config, { only: ["fast"], runtime, force: true });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") throw new Error("unreachable");
    expect(outcome.results[0]?.status).toBe("started");
    expect(runtime.startCalls).toHaveLength(1);
  });

  it("down stops a running server and reports what was actually stopped", async () => {
    const config = testConfig();
    const pidFile = path.join(stateDir(), "run", "fast.pid");
    fs.mkdirSync(path.dirname(pidFile), { recursive: true });
    fs.writeFileSync(pidFile, String(process.pid));

    const runtime = createFakeRuntime();
    const results = await downAll(config, { only: ["fast", "deep"], runtime });
    expect(results).toEqual([
      { role: "fast", name: "fast-model", stopped: true },
      { role: "deep", name: "deep-model", stopped: false },
    ]);
    expect(runtime.stopCalls).toHaveLength(2);
  });

  it("status reports running+healthy, running+unhealthy, and not-running", async () => {
    const config = testConfig();
    const fastPid = path.join(stateDir(), "run", "fast.pid");
    fs.mkdirSync(path.dirname(fastPid), { recursive: true });
    fs.writeFileSync(fastPid, String(process.pid));

    const runtime = createFakeRuntime({ defaultHealthy: true });
    const results = await statusAll(config, { runtime });
    expect(results).toEqual([
      { role: "fast", name: "fast-model", port: 18081, pid: process.pid, running: true, healthy: true },
      { role: "deep", name: "deep-model", port: 18082, pid: undefined, running: false, healthy: false },
    ]);
  });
});
