import { describe, expect, it } from "vitest";
import { checkPrerequisites } from "../src/runtime/prerequisites.js";
import { detectGpuBackend } from "../src/runtime/platform.js";

describe("checkPrerequisites", () => {
  it("reports ok when git, cmake and a compiler are present", () => {
    const report = checkPrerequisites(() => true);
    expect(report.ok).toBe(true);
    expect(report.missingInstructions).toEqual([]);
  });

  it("lists actionable instructions for each missing tool", () => {
    const report = checkPrerequisites(() => false);
    expect(report.ok).toBe(false);
    expect(report.git).toBe(false);
    expect(report.cmake).toBe(false);
    expect(report.compiler).toBe(false);
    expect(report.missingInstructions).toHaveLength(3);
    expect(report.missingInstructions.join(" ")).toMatch(/git/i);
    expect(report.missingInstructions.join(" ")).toMatch(/cmake/i);
  });

  it("finds the first available compiler candidate", () => {
    const report = checkPrerequisites((cmd) => cmd === "git" || cmd === "cmake" || cmd === "clang");
    expect(report.ok).toBe(true);
    expect(report.compilerName).toBe("clang");
  });

  it("detects nvcc independently of the other checks", () => {
    const report = checkPrerequisites((cmd) => cmd === "nvcc");
    expect(report.nvcc).toBe(true);
    expect(report.ok).toBe(false);
  });
});

describe("detectGpuBackend", () => {
  it("prefers CUDA when nvcc is present", () => {
    const detection = detectGpuBackend(true);
    expect(detection.backend).toBe("cuda");
    expect(detection.cmakeFlags).toContain("-DGGML_CUDA=ON");
  });

  it("falls back to the platform default when nvcc is absent", () => {
    const detection = detectGpuBackend(false);
    expect(detection.backend).toBe(process.platform === "darwin" ? "metal" : "cpu");
    expect(detection.cmakeFlags).toEqual([]);
  });
});
