export { TOOL_NAME } from "./constants.js";
export { loadConfig, ConfigError, ConfigSchema, DEFAULT_CONFIG } from "./config.js";
export type { ReflexConfig, RuntimeConfig, RouterConfig, GenerationParams } from "./config.js";

export { decide, answerSchema, DecideError } from "./core/decide.js";
export type { DecideOptions, DecideResult, QuestionResult } from "./core/decide.js";

export { parseDecisionSchema, toJsonSchema, narrowSchema, SchemaError } from "./core/schema.js";
export type { DecisionSchema, DecisionQuestion } from "./core/schema.js";

export { shouldEscalate } from "./core/router.js";
export { confidenceFor, extractTokenLogprobs, computeAnswerConfidence } from "./core/confidence.js";
export type { TokenLogprob } from "./core/confidence.js";
export { fitTemperature, CalibrationError } from "./core/calibration.js";
export type { CalibrationExample, CalibrationFit } from "./core/calibration.js";
export { BackendError } from "./core/backend.js";

export { loadTasks, BenchTaskError } from "./bench/tasks.js";
export type { BenchTask } from "./bench/tasks.js";
export { runBench, runBenchMode, BENCH_MODES } from "./bench/runner.js";
export type { BenchMode, BenchModeReport, BenchReport, BenchOptions } from "./bench/runner.js";
