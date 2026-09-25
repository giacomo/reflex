import { describe, expect, it } from "vitest";
import { pickQuantFile, QuantSelectionError } from "../src/models/quant.js";
import type { HfFile } from "../src/models/hf.js";

function file(path: string, size = 1000): HfFile {
  return { path, size, sha256: "deadbeef" };
}

describe("pickQuantFile", () => {
  it("picks the first matching quant in preference order", () => {
    const files = [file("Model-Q8_0.gguf"), file("Model-Q4_K_M.gguf"), file("Model-F16.gguf")];
    const picked = pickQuantFile(files, ["Q4_K_M", "Q8_0"]);
    expect(picked.path).toBe("Model-Q4_K_M.gguf");
  });

  it("does not match a quant tag as a loose substring", () => {
    const files = [file("Model-Q4_K_M_XL.gguf", 4000), file("Model-IQ4_K_M.gguf", 3000)];
    // Neither "Q4_K_M_XL" nor "IQ4_K_M" is a plain "Q4_K_M"; falls back to smallest.
    const picked = pickQuantFile(files, ["Q4_K_M"]);
    expect(picked.path).toBe("Model-IQ4_K_M.gguf");
  });

  it("falls back to the smallest gguf file when no preferred quant matches", () => {
    const files = [file("Model-F32.gguf", 5000), file("Model-F16.gguf", 2000)];
    const picked = pickQuantFile(files, ["Q4_K_M"]);
    expect(picked.path).toBe("Model-F16.gguf");
  });

  it("ignores non-gguf files", () => {
    const files = [file("README.md", 10), file("Model-Q4_K_M.gguf")];
    const picked = pickQuantFile(files, ["Q4_K_M"]);
    expect(picked.path).toBe("Model-Q4_K_M.gguf");
  });

  it("throws when there are no gguf files at all", () => {
    expect(() => pickQuantFile([file("README.md", 10)], ["Q4_K_M"])).toThrow(
      QuantSelectionError,
    );
  });
});
