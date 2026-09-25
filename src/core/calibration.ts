import { confidenceFor } from "./confidence.js";
import { expectedCalibrationError, type CalibrationSample } from "../bench/metrics.js";

export class CalibrationError extends Error {}

export interface CalibrationExample {
  raw: unknown;
  content: string;
  questionName: string;
  correct: boolean;
}

export interface CalibrationFit {
  temperature: number;
  ece: number;
  sampleCount: number;
}

function defaultCandidates(): number[] {
  const candidates: number[] = [];
  for (let t = 0.1; t <= 5.0 + 1e-9; t += 0.1) {
    candidates.push(Math.round(t * 100) / 100);
  }
  return candidates;
}

/**
 * Grid search over candidate temperatures, picking the one that minimizes
 * Expected Calibration Error against ground truth. Not gradient-based: with
 * ~50 candidates and typical bench task counts this is fast enough, and ECE
 * over a temperature grid isn't guaranteed convex, so a grid search is
 * safer than assuming one.
 */
export function fitTemperature(
  examples: readonly CalibrationExample[],
  candidates: readonly number[] = defaultCandidates(),
): CalibrationFit {
  let best: CalibrationFit | undefined;
  for (const temperature of candidates) {
    const samples: CalibrationSample[] = [];
    for (const example of examples) {
      const confidence = confidenceFor(example.raw, example.content, example.questionName, temperature);
      if (confidence !== undefined) {
        samples.push({ confidence, correct: example.correct });
      }
    }
    const ece = expectedCalibrationError(samples);
    if (ece === null) continue;
    if (!best || ece < best.ece) {
      best = { temperature, ece, sampleCount: samples.length };
    }
  }
  if (!best) {
    throw new CalibrationError(
      "No usable logprobs were found across the calibration tasks; the backend may not be honoring n_probs.",
    );
  }
  return best;
}
