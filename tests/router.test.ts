import { describe, expect, it } from "vitest";
import { shouldEscalate } from "../src/core/router.js";
import { ConfigSchema } from "../src/config.js";

describe("shouldEscalate", () => {
  const router = ConfigSchema.parse({}).router; // threshold 0.8, onMissingConfidence "escalate"

  it("escalates below the threshold", () => {
    expect(shouldEscalate(0.5, router)).toBe(true);
  });

  it("does not escalate at or above the threshold", () => {
    expect(shouldEscalate(0.8, router)).toBe(false);
    expect(shouldEscalate(0.99, router)).toBe(false);
  });

  it("escalates on missing confidence when onMissingConfidence is escalate", () => {
    expect(shouldEscalate(undefined, router)).toBe(true);
  });

  it("accepts on missing confidence when onMissingConfidence is accept", () => {
    const accepting = ConfigSchema.parse({ router: { onMissingConfidence: "accept" } }).router;
    expect(shouldEscalate(undefined, accepting)).toBe(false);
  });
});
