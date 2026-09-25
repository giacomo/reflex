/** Linear-interpolation percentile, `p` in [0, 1]. Returns 0 for an empty input. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const rank = p * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower]!;
  const weight = rank - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

export interface CalibrationSample {
  confidence: number;
  correct: boolean;
}

/**
 * Expected Calibration Error: samples are bucketed into `bins` equal-width
 * confidence ranges; each bucket contributes |accuracy - mean confidence|
 * weighted by its share of all samples. Lower is better calibrated; 0 is
 * perfect. Returns null for zero samples (nothing to calibrate against).
 */
export function expectedCalibrationError(samples: readonly CalibrationSample[], bins = 10): number | null {
  if (samples.length === 0) return null;
  const buckets: Array<{ confidenceSum: number; correctCount: number; total: number }> = Array.from(
    { length: bins },
    () => ({ confidenceSum: 0, correctCount: 0, total: 0 }),
  );
  for (const sample of samples) {
    const clamped = Math.min(1, Math.max(0, sample.confidence));
    const index = Math.min(bins - 1, Math.floor(clamped * bins));
    const bucket = buckets[index]!;
    bucket.confidenceSum += clamped;
    bucket.correctCount += sample.correct ? 1 : 0;
    bucket.total += 1;
  }
  let ece = 0;
  for (const bucket of buckets) {
    if (bucket.total === 0) continue;
    const avgConfidence = bucket.confidenceSum / bucket.total;
    const accuracy = bucket.correctCount / bucket.total;
    ece += (bucket.total / samples.length) * Math.abs(accuracy - avgConfidence);
  }
  return ece;
}

export function accuracy(pairs: ReadonlyArray<{ answer: string; expected: string }>): number {
  if (pairs.length === 0) return 0;
  const correct = pairs.filter((p) => p.answer === p.expected).length;
  return correct / pairs.length;
}
