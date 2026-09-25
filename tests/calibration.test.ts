import { describe, expect, it } from "vitest";
import { fitTemperature, CalibrationError, type CalibrationExample } from "../src/core/calibration.js";
import { confidenceFor } from "../src/core/confidence.js";
import { expectedCalibrationError } from "../src/bench/metrics.js";

function rawFor(value: string, logprob: number, altLogprob: number, altToken: string): unknown {
  const content = `{"q":"${value}"}`;
  return {
    completion_probabilities: [
      {
        token: content,
        logprob,
        top_logprobs: [
          { token: content, logprob },
          { token: content.replace(value, altToken), logprob: altLogprob },
        ],
      },
    ],
  };
}

describe("fitTemperature", () => {
  it("throws a clear error when no example has usable logprobs", () => {
    const examples: CalibrationExample[] = [{ raw: {}, content: "{}", questionName: "q", correct: true }];
    expect(() => fitTemperature(examples)).toThrow(CalibrationError);
  });

  it("picks a temperature that is at least as well calibrated as T=1 on an overconfident dataset", () => {
    // The model is always very confident (dominant token vs. a much less likely
    // alternative) but is only actually correct about half the time: classic
    // overconfidence that temperature scaling should partially correct.
    const examples: CalibrationExample[] = [];
    for (let i = 0; i < 40; i++) {
      const correct = i % 2 === 0;
      const raw = rawFor("yes", -0.02, -6, "no");
      examples.push({ raw, content: '{"q":"yes"}', questionName: "q", correct });
    }

    const fit = fitTemperature(examples);

    const eceAtOne = expectedCalibrationError(
      examples
        .map((e) => ({
          confidence: confidenceFor(e.raw, e.content, e.questionName, 1.0),
          correct: e.correct,
        }))
        .filter((s): s is { confidence: number; correct: boolean } => s.confidence !== undefined),
    )!;

    expect(fit.ece).toBeLessThanOrEqual(eceAtOne);
    expect(fit.temperature).toBeGreaterThan(1.0);
    expect(fit.sampleCount).toBe(examples.length);
  });
});
