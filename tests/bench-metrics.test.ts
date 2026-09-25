import { describe, expect, it } from "vitest";
import { percentile, expectedCalibrationError, accuracy } from "../src/bench/metrics.js";

describe("percentile", () => {
  it("returns 0 for an empty array", () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it("returns the single value for a one-element array", () => {
    expect(percentile([42], 0.95)).toBe(42);
  });

  it("computes p50 (median) via linear interpolation", () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBeCloseTo(25, 5);
  });

  it("computes p95 close to the max for a small sorted set", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(values, 0.95)).toBeCloseTo(95.05, 1);
  });

  it("is order-independent", () => {
    expect(percentile([30, 10, 40, 20], 0.5)).toBeCloseTo(percentile([10, 20, 30, 40], 0.5), 10);
  });
});

describe("accuracy", () => {
  it("returns 0 for an empty list", () => {
    expect(accuracy([])).toBe(0);
  });

  it("computes the fraction of exact matches", () => {
    expect(
      accuracy([
        { answer: "a", expected: "a" },
        { answer: "b", expected: "a" },
        { answer: "c", expected: "c" },
      ]),
    ).toBeCloseTo(2 / 3, 10);
  });
});

describe("expectedCalibrationError", () => {
  it("returns null for zero samples", () => {
    expect(expectedCalibrationError([])).toBeNull();
  });

  it("is ~0 for perfectly calibrated confidence", () => {
    // 10 samples at confidence 0.9, exactly 9 correct: matches its own bucket perfectly.
    const samples = Array.from({ length: 10 }, (_, i) => ({ confidence: 0.9, correct: i < 9 }));
    expect(expectedCalibrationError(samples)!).toBeCloseTo(0, 5);
  });

  it("is high for systematically overconfident predictions", () => {
    // Always claims 0.99 confidence but is only right half the time.
    const samples = Array.from({ length: 20 }, (_, i) => ({ confidence: 0.99, correct: i % 2 === 0 }));
    expect(expectedCalibrationError(samples)!).toBeGreaterThan(0.4);
  });
});
