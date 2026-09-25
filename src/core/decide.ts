import type { GenerationParams, RouterConfig } from "../config.js";
import { type DecisionSchema, toJsonSchema, narrowSchema } from "./schema.js";
import { buildMessages } from "./prompt.js";
import { applyTemplate, complete, BackendError } from "./backend.js";
import { confidenceFor } from "./confidence.js";
import { shouldEscalate } from "./router.js";

export class DecideError extends Error {}

export interface QuestionResult {
  name: string;
  answer: string;
  /** null when the backend gave us no usable logprobs for this answer. */
  confidence: number | null;
  decidedBy: "fast" | "deep";
  latencyMs: number;
}

export interface DecideResult {
  results: QuestionResult[];
  totalLatencyMs: number;
  escalationRate: number;
}

export interface DecideOptions {
  fastBaseUrl: string;
  deepBaseUrl: string;
  schema: DecisionSchema;
  state: string | Record<string, unknown>;
  router: RouterConfig;
  fastGeneration: GenerationParams;
  deepGeneration: GenerationParams;
  /** How many alternatives to request per token for confidence extraction. */
  nProbs?: number;
}

export interface RawAnswers {
  [questionName: string]: string;
}

export interface AnswerSchemaResult {
  answers: RawAnswers;
  content: string;
  raw: unknown;
  latencyMs: number;
}

/**
 * Sends a whole schema (one or more questions) to a single model in one
 * call. Exported so bench.ts can drive the fast-only and deep-only modes
 * directly, without going through decide()'s routing.
 */
export async function answerSchema(
  baseUrl: string,
  schema: DecisionSchema,
  state: string | Record<string, unknown>,
  generation: GenerationParams,
  nProbs: number,
): Promise<AnswerSchemaResult> {
  const messages = buildMessages(state, schema);
  const jsonSchema = toJsonSchema(schema);
  const prompt = await applyTemplate(baseUrl, messages);
  const result = await complete(baseUrl, prompt, { jsonSchema, generation, nProbs });

  let answers: unknown;
  try {
    answers = JSON.parse(result.content);
  } catch {
    throw new DecideError(
      `${baseUrl} did not return valid JSON despite a json_schema constraint: ${result.content}`,
    );
  }
  if (typeof answers !== "object" || answers === null) {
    throw new DecideError(`${baseUrl} returned a non-object JSON value: ${result.content}`);
  }
  return { answers: answers as RawAnswers, content: result.content, raw: result.raw, latencyMs: result.latencyMs };
}

function isAllowedAnswer(schema: DecisionSchema, name: string, value: unknown): value is string {
  const question = schema.questions.find((q) => q.name === name);
  return typeof value === "string" && (question?.options.includes(value) ?? false);
}

export async function decide(opts: DecideOptions): Promise<DecideResult> {
  const nProbs = opts.nProbs ?? 5;
  const startedAt = Date.now();

  const fast = await answerSchema(opts.fastBaseUrl, opts.schema, opts.state, opts.fastGeneration, nProbs);

  const results: QuestionResult[] = [];
  const toEscalate: string[] = [];

  for (const question of opts.schema.questions) {
    const value = fast.answers[question.name];
    if (!isAllowedAnswer(opts.schema, question.name, value)) {
      toEscalate.push(question.name);
      continue;
    }
    const confidence = confidenceFor(fast.raw, fast.content, question.name, opts.router.calibration.temperature);
    if (shouldEscalate(confidence, opts.router)) {
      toEscalate.push(question.name);
      continue;
    }
    results.push({
      name: question.name,
      answer: value,
      confidence: confidence ?? null,
      decidedBy: "fast",
      latencyMs: fast.latencyMs,
    });
  }

  const escalations = await Promise.all(
    toEscalate.map(async (name) => {
      const narrowed = narrowSchema(opts.schema, name);
      const deep = await answerSchema(opts.deepBaseUrl, narrowed, opts.state, opts.deepGeneration, nProbs);
      const value = deep.answers[name];
      const question = narrowed.questions[0]!;
      const answer = isAllowedAnswer(narrowed, name, value) ? value : question.options[0]!;
      const confidence = confidenceFor(deep.raw, deep.content, name, opts.router.calibration.temperature);
      const result: QuestionResult = {
        name,
        answer,
        confidence: confidence ?? null,
        decidedBy: "deep",
        latencyMs: deep.latencyMs,
      };
      return result;
    }),
  );
  results.push(...escalations);

  const order = new Map(opts.schema.questions.map((q, i) => [q.name, i]));
  results.sort((a, b) => order.get(a.name)! - order.get(b.name)!);

  return {
    results,
    totalLatencyMs: Date.now() - startedAt,
    escalationRate: toEscalate.length / opts.schema.questions.length,
  };
}

export { BackendError };
