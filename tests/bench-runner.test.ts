import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTasks } from "../src/bench/tasks.js";
import { runBench, runBenchMode } from "../src/bench/runner.js";
import { ConfigSchema } from "../src/config.js";
import { startFakeLlamaServer, tokenizeContent, type FakeLlamaServer } from "./helpers/fake-llama-server.js";

const defaults = ConfigSchema.parse({});

function writeTasksFile(): string {
  const file = path.join(os.tmpdir(), `reflex-bench-tasks-${Date.now()}.jsonl`);
  const lines = [
    { schema: { questions: [{ name: "mood", options: ["happy", "sad"] }] }, state: "a", expected: { mood: "happy" } },
    { schema: { questions: [{ name: "mood", options: ["happy", "sad"] }] }, state: "b", expected: { mood: "sad" } },
  ];
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n"));
  return file;
}

describe("bench runner", () => {
  let fast: FakeLlamaServer | undefined;
  let deep: FakeLlamaServer | undefined;
  let tasksFile: string | undefined;

  afterEach(async () => {
    await fast?.close();
    await deep?.close();
    if (tasksFile) fs.rmSync(tasksFile, { force: true });
    fast = undefined;
    deep = undefined;
    tasksFile = undefined;
  });

  it("fast-only mode never calls the deep server", async () => {
    tasksFile = writeTasksFile();
    const tasks = loadTasks(tasksFile);

    fast = await startFakeLlamaServer(() => {
      const content = '{"mood":"happy"}';
      return { content, tokens: tokenizeContent(content, [{ value: "happy", logprob: -0.01, alternatives: [] }]) };
    });
    deep = await startFakeLlamaServer(() => {
      throw new Error("deep should not be called in fast-only mode");
    });

    const report = await runBenchMode("fast-only", tasks, {
      fastBaseUrl: fast.url,
      deepBaseUrl: deep.url,
      router: defaults.router,
      fastGeneration: defaults.fast,
      deepGeneration: defaults.deep,
    });

    expect(report.mode).toBe("fast-only");
    expect(report.taskCount).toBe(2);
    expect(report.sampleCount).toBe(2);
    expect(report.escalationRate).toBe(0);
    expect(report.accuracy).toBeGreaterThanOrEqual(0);
    expect(deep.requests).toHaveLength(0);
  });

  it("combined mode escalates low-confidence answers to the deep server", async () => {
    tasksFile = writeTasksFile();
    const tasks = loadTasks(tasksFile);

    fast = await startFakeLlamaServer(() => {
      // Always unsure between happy/sad: forces escalation on every task.
      const content = '{"mood":"happy"}';
      return {
        content,
        tokens: tokenizeContent(content, [{ value: "happy", logprob: -0.69, alternatives: [["sad", -0.7]] }]),
      };
    });
    deep = await startFakeLlamaServer(() => {
      const content = '{"mood":"sad"}';
      return { content, tokens: tokenizeContent(content, [{ value: "sad", logprob: -0.01, alternatives: [] }]) };
    });

    const report = await runBenchMode("combined", tasks, {
      fastBaseUrl: fast.url,
      deepBaseUrl: deep.url,
      router: defaults.router,
      fastGeneration: defaults.fast,
      deepGeneration: defaults.deep,
    });

    expect(report.escalationRate).toBe(1);
    expect(deep.requests.length).toBeGreaterThan(0);
    expect(report.accuracy).toBe(0.5); // task "a" expects happy, task "b" expects sad; deep always says sad
  });

  it("runBench produces a report for all three modes", async () => {
    tasksFile = writeTasksFile();
    const tasks = loadTasks(tasksFile);

    fast = await startFakeLlamaServer(() => {
      const content = '{"mood":"happy"}';
      return { content, tokens: tokenizeContent(content, [{ value: "happy", logprob: -0.01, alternatives: [] }]) };
    });
    deep = await startFakeLlamaServer(() => {
      const content = '{"mood":"happy"}';
      return { content, tokens: tokenizeContent(content, [{ value: "happy", logprob: -0.01, alternatives: [] }]) };
    });

    const report = await runBench(tasks, {
      fastBaseUrl: fast.url,
      deepBaseUrl: deep.url,
      router: defaults.router,
      fastGeneration: defaults.fast,
      deepGeneration: defaults.deep,
    });

    expect(report.modes.map((m) => m.mode)).toEqual(["fast-only", "deep-only", "combined"]);
    for (const m of report.modes) {
      expect(m.taskCount).toBe(2);
      expect(typeof m.latencyP50Ms).toBe("number");
      expect(typeof m.latencyP95Ms).toBe("number");
    }
  });
});
