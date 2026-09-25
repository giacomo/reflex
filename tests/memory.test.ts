import { describe, expect, it } from "vitest";
import { checkMemory, readProcessRssBytes } from "../src/runtime/memory.js";

describe("checkMemory", () => {
  it("sums requirements and compares to available bytes", () => {
    const check = checkMemory(
      [
        { role: "fast", name: "a", requiredBytes: 1000 },
        { role: "deep", name: "b", requiredBytes: 2000 },
      ],
      2500,
    );
    expect(check.totalRequiredBytes).toBe(3000);
    expect(check.sufficient).toBe(false);
  });

  it("is sufficient when requirements fit", () => {
    const check = checkMemory([{ role: "fast", name: "a", requiredBytes: 1000 }], 2000);
    expect(check.sufficient).toBe(true);
  });
});

describe("readProcessRssBytes", () => {
  it("returns a positive byte count for this test process's own pid", () => {
    if (process.platform === "win32") return; // `ps` isn't available; feature is Linux/macOS-only.
    const rss = readProcessRssBytes(process.pid);
    expect(rss).toBeGreaterThan(0);
  });

  it("returns undefined for a pid that doesn't exist", () => {
    if (process.platform === "win32") return;
    expect(readProcessRssBytes(999_999)).toBeUndefined();
  });
});
