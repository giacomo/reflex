import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildRuntime, readLock, serverBinaryPath, BuildError } from "../src/runtime/build.js";
import type { Exec, ExecResult } from "../src/runtime/exec.js";

function fakeExec(dir: string, overrides: Partial<Record<string, ExecResult>> = {}): {
  exec: Exec;
  calls: Array<{ command: string; args: string[] }>;
} {
  const calls: Array<{ command: string; args: string[] }> = [];
  const exec: Exec = async (command, args) => {
    calls.push({ command, args });
    const key = `${command} ${args[0]}`;
    if (overrides[key]) return overrides[key]!;

    if (command === "git" && args[0] === "clone") {
      fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "cmake" && args[0] === "-B") {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "cmake" && args[0] === "--build") {
      const bin = serverBinaryPath(dir);
      fs.mkdirSync(path.dirname(bin), { recursive: true });
      fs.writeFileSync(bin, "#!/bin/sh\necho fake llama-server\n");
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "git" && args[0] === "rev-parse") {
      return { status: 0, stdout: "abc123\n", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  return { exec, calls };
}

describe("buildRuntime", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "reflex-runtime-test-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("clones, configures, builds, and writes a lock file", async () => {
    const { exec, calls } = fakeExec(dir);
    const lock = await buildRuntime({ dir, exec, hasNvcc: false });

    expect(lock.commitHash).toBe("abc123");
    expect(lock.backend).toBe(process.platform === "darwin" ? "metal" : "cpu");
    expect(fs.existsSync(serverBinaryPath(dir))).toBe(true);
    expect(readLock(dir)?.commitHash).toBe("abc123");

    const commands = calls.map((c) => `${c.command} ${c.args[0]}`);
    expect(commands).toEqual(["git clone", "cmake -B", "cmake --build", "git rev-parse"]);
  });

  it("passes -DGGML_CUDA=ON when nvcc is available", async () => {
    const { exec, calls } = fakeExec(dir);
    await buildRuntime({ dir, exec, hasNvcc: true });
    const configureCall = calls.find((c) => c.args[0] === "-B");
    expect(configureCall?.args).toContain("-DGGML_CUDA=ON");
  });

  it("is idempotent: skips build entirely on a second call", async () => {
    const { exec, calls } = fakeExec(dir);
    await buildRuntime({ dir, exec, hasNvcc: false });
    const callsAfterFirst = calls.length;

    const lock = await buildRuntime({ dir, exec, hasNvcc: false });
    expect(calls.length).toBe(callsAfterFirst);
    expect(lock.commitHash).toBe("abc123");
  });

  it("rebuilds when force is set", async () => {
    const { exec, calls } = fakeExec(dir);
    await buildRuntime({ dir, exec, hasNvcc: false });
    const callsAfterFirst = calls.length;

    await buildRuntime({ dir, exec, hasNvcc: false, force: true });
    expect(calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("throws a BuildError with the exit code when cmake configure fails", async () => {
    const { exec } = fakeExec(dir, {
      "cmake -B": { status: 1, stdout: "", stderr: "config error" },
    });
    await expect(buildRuntime({ dir, exec, hasNvcc: false })).rejects.toThrow(BuildError);
  });

  it("throws a BuildError when the build succeeds but no binary appears", async () => {
    const exec: Exec = async (command, args) => {
      if (command === "git" && args[0] === "clone") {
        fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
      }
      return { status: 0, stdout: "deadbeef\n", stderr: "" };
    };
    await expect(buildRuntime({ dir, exec, hasNvcc: false })).rejects.toThrow(BuildError);
  });
});
