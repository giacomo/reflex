import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTasks, BenchTaskError } from "../src/bench/tasks.js";

describe("loadTasks", () => {
  let file: string | undefined;

  afterEach(() => {
    if (file) fs.rmSync(file, { force: true });
    file = undefined;
  });

  function writeTasks(lines: string[]): string {
    file = path.join(os.tmpdir(), `reflex-tasks-${Date.now()}-${Math.random()}.jsonl`);
    fs.writeFileSync(file, lines.join("\n"));
    return file;
  }

  it("parses valid tasks, skipping blank lines", () => {
    const f = writeTasks([
      JSON.stringify({
        schema: { questions: [{ name: "mood", options: ["happy", "sad"] }] },
        state: "fine",
        expected: { mood: "happy" },
      }),
      "",
      JSON.stringify({
        schema: { questions: [{ name: "mood", options: ["happy", "sad"] }] },
        state: { note: "ok" },
        expected: { mood: "sad" },
      }),
    ]);
    const tasks = loadTasks(f);
    expect(tasks).toHaveLength(2);
    expect(tasks[1]?.state).toEqual({ note: "ok" });
  });

  it("throws with a line number for invalid JSON", () => {
    const f = writeTasks(["{ not json"]);
    expect(() => loadTasks(f)).toThrow(/:1:/);
  });

  it("throws when expected is missing an answer for a question", () => {
    const f = writeTasks([
      JSON.stringify({
        schema: { questions: [{ name: "mood", options: ["happy", "sad"] }] },
        state: "fine",
        expected: {},
      }),
    ]);
    expect(() => loadTasks(f)).toThrow(BenchTaskError);
  });

  it("throws for an empty file", () => {
    const f = writeTasks([""]);
    expect(() => loadTasks(f)).toThrow(/no tasks/);
  });
});
