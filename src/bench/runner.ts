import type { GenerationParams, RouterConfig } from "../config.js";
import { answerSchema, decide } from "../core/decide.js";
import { confidenceFor } from "../core/confidence.js";
import type { BenchTask } from "./tasks.js";
import { percentile, expectedCalibrationError, accuracy, type CalibrationSample } from "./metrics.js";

export type BenchMode = "fast-only" | "deep-only" | "combined";
export const BENCH_MODES: readonly BenchMode[] = ["fast-only", "deep-only", "combined"];

export interface BenchOptions {
  fastBaseUrl: string;
  deepBaseUrl: string;
  router: RouterConfig;
  fastGeneration: GenerationParams;
  deepGeneration: GenerationParams;
  nProbs?: number;
}

export interface BenchModeReport {
  mode: BenchMode;
  taskCount: number;
  sampleCount: number;
  accuracy: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  escalationRate: number;
  ece: number | null;
  missingConfidenceCount: number;
}

async function runSingleModel(
  mode: "fast-only" | "deep-only",
  tasks: readonly BenchTask[],
  opts: BenchOptions,
): Promise<BenchModeReport> {
  const baseUrl = mode === "fast-only" ? opts.fastBaseUrl : opts.deepBaseUrl;
  const generation = mode === "fast-only" ? opts.fastGeneration : opts.deepGeneration;
  const nProbs = opts.nProbs ?? 5;

  const latencies: number[] = [];
  const answerPairs: Array<{ answer: string; expected: string }> = [];
  const calibrationSamples: CalibrationSample[] = [];
  let missingConfidenceCount = 0;

  for (const task of tasks) {
    const result = await answerSchema(baseUrl, task.schema, task.state, generation, nProbs);
    latencies.push(result.latencyMs);
    for (const question of task.schema.questions) {
      const answer = result.answers[question.name] ?? "";
      const expected = task.expected[question.name]!;
      answerPairs.push({ answer, expected });
      const confidence = confidenceFor(result.raw, result.content, question.name, opts.router.calibration.temperature);
      if (confidence === undefined) {
        missingConfidenceCount++;
      } else {
        calibrationSamples.push({ confidence, correct: answer === expected });
      }
    }
  }

  return {
    mode,
    taskCount: tasks.length,
    sampleCount: answerPairs.length,
    accuracy: accuracy(answerPairs),
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    escalationRate: 0,
    ece: expectedCalibrationError(calibrationSamples),
    missingConfidenceCount,
  };
}

async function runCombined(tasks: readonly BenchTask[], opts: BenchOptions): Promise<BenchModeReport> {
  const latencies: number[] = [];
  const answerPairs: Array<{ answer: string; expected: string }> = [];
  const calibrationSamples: CalibrationSample[] = [];
  let missingConfidenceCount = 0;
  let escalatedQuestions = 0;
  let totalQuestions = 0;

  for (const task of tasks) {
    const result = await decide({
      fastBaseUrl: opts.fastBaseUrl,
      deepBaseUrl: opts.deepBaseUrl,
      schema: task.schema,
      state: task.state,
      router: opts.router,
      fastGeneration: opts.fastGeneration,
      deepGeneration: opts.deepGeneration,
      ...(opts.nProbs !== undefined ? { nProbs: opts.nProbs } : {}),
    });
    latencies.push(result.totalLatencyMs);
    totalQuestions += task.schema.questions.length;
    escalatedQuestions += Math.round(result.escalationRate * task.schema.questions.length);
    for (const r of result.results) {
      const expected = task.expected[r.name]!;
      answerPairs.push({ answer: r.answer, expected });
      if (r.confidence === null) {
        missingConfidenceCount++;
      } else {
        calibrationSamples.push({ confidence: r.confidence, correct: r.answer === expected });
      }
    }
  }

  return {
    mode: "combined",
    taskCount: tasks.length,
    sampleCount: answerPairs.length,
    accuracy: accuracy(answerPairs),
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    escalationRate: totalQuestions === 0 ? 0 : escalatedQuestions / totalQuestions,
    ece: expectedCalibrationError(calibrationSamples),
    missingConfidenceCount,
  };
}

export async function runBenchMode(
  mode: BenchMode,
  tasks: readonly BenchTask[],
  opts: BenchOptions,
): Promise<BenchModeReport> {
  if (mode === "combined") return runCombined(tasks, opts);
  return runSingleModel(mode, tasks, opts);
}

export interface BenchReport {
  modes: BenchModeReport[];
}

export async function runBench(tasks: readonly BenchTask[], opts: BenchOptions): Promise<BenchReport> {
  const modes: BenchModeReport[] = [];
  for (const mode of BENCH_MODES) {
    modes.push(await runBenchMode(mode, tasks, opts));
  }
  return { modes };
}
