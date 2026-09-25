import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import {
  buildServerArgs,
  startServer,
  stopServer,
  readPidFile,
  ServerError,
} from "../src/runtime/server.js";
import type { GenerationParams } from "../src/config.js";

const generation: GenerationParams = { temperature: 0.7, topP: 0.95, topK: 40, minP: 0 };

describe("buildServerArgs", () => {
  it("includes model, context, gpu layers, threads, host, port and sampling flags", () => {
    const args = buildServerArgs({
      binaryPath: "/bin/llama-server",
      modelPath: "/models/x.gguf",
      host: "127.0.0.1",
      port: 8081,
      contextSize: 4096,
      gpuLayers: "auto",
      threads: -1,
      generation,
      enableThinking: false,
      logFile: "/tmp/x.log",
      pidFile: "/tmp/x.pid",
    });
    expect(args).toEqual([
      "-m", "/models/x.gguf",
      "-c", "4096",
      "-ngl", "auto",
      "-t", "-1",
      "--host", "127.0.0.1",
      "--port", "8081",
      "--jinja",
      "--chat-template-kwargs", JSON.stringify({ enable_thinking: false }),
      "--temp", "0.7",
      "--top-p", "0.95",
      "--top-k", "40",
      "--min-p", "0",
    ]);
  });
});

describe("startServer", () => {
  it("throws a clear ServerError when the binary is missing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reflex-server-test-"));
    const modelPath = path.join(tmpDir, "model.gguf");
    fs.writeFileSync(modelPath, "");
    expect(() =>
      startServer({
        binaryPath: path.join(tmpDir, "no-such-binary"),
        modelPath,
        host: "127.0.0.1",
        port: 8081,
        contextSize: 4096,
        gpuLayers: "auto",
        threads: -1,
        generation,
        enableThinking: false,
        logFile: path.join(tmpDir, "log.txt"),
        pidFile: path.join(tmpDir, "pid.txt"),
      }),
    ).toThrow(ServerError);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws a clear ServerError when the model file is missing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reflex-server-test-"));
    const binaryPath = path.join(tmpDir, "fake-binary");
    fs.writeFileSync(binaryPath, "");
    expect(() =>
      startServer({
        binaryPath,
        modelPath: path.join(tmpDir, "missing.gguf"),
        host: "127.0.0.1",
        port: 8081,
        contextSize: 4096,
        gpuLayers: "auto",
        threads: -1,
        generation,
        enableThinking: false,
        logFile: path.join(tmpDir, "log.txt"),
        pidFile: path.join(tmpDir, "pid.txt"),
      }),
    ).toThrow(ServerError);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("stopServer", () => {
  let child: ChildProcess | undefined;
  let tmpDir: string;

  afterEach(() => {
    child?.kill("SIGKILL");
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("terminates a running process and removes the pid file", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reflex-stop-test-"));
    const pidFile = path.join(tmpDir, "server.pid");
    child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    fs.writeFileSync(pidFile, String(child.pid));

    await stopServer(pidFile);

    expect(fs.existsSync(pidFile)).toBe(false);
    await new Promise((r) => setTimeout(r, 100));
    expect(() => process.kill(child!.pid!, 0)).toThrow();
  });

  it("is a no-op (but cleans up the pid file) when the process is already gone", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reflex-stop-test-"));
    const pidFile = path.join(tmpDir, "server.pid");
    fs.writeFileSync(pidFile, "999999");
    await stopServer(pidFile);
    expect(fs.existsSync(pidFile)).toBe(false);
  });

  it("readPidFile returns undefined when there is no pid file", () => {
    expect(readPidFile("/no/such/file")).toBeUndefined();
  });
});
