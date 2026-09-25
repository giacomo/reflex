import type { GenerationParams } from "../config.js";
import type { ChatMessage } from "./prompt.js";

export class BackendError extends Error {}

export interface CompletionResult {
  content: string;
  raw: unknown;
  latencyMs: number;
}

/** POST /apply-template: renders `messages` through the model's own chat template. */
export async function applyTemplate(baseUrl: string, messages: ChatMessage[]): Promise<string> {
  const res = await fetch(`${baseUrl}/apply-template`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) {
    throw new BackendError(`${baseUrl}/apply-template failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { prompt?: unknown };
  if (typeof body.prompt !== "string") {
    throw new BackendError(`${baseUrl}/apply-template did not return a "prompt" string.`);
  }
  return body.prompt;
}

export interface CompleteOptions {
  jsonSchema: Record<string, unknown>;
  generation: GenerationParams;
  nProbs: number;
}

/**
 * POST /completion with JSON-schema-constrained decoding and `n_probs` for
 * per-token logprobs, per the fork's tools/server/README.md ("json_schema",
 * "n_probs" sampling params).
 */
export async function complete(
  baseUrl: string,
  prompt: string,
  opts: CompleteOptions,
): Promise<CompletionResult> {
  const startedAt = Date.now();
  const res = await fetch(`${baseUrl}/completion`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt,
      json_schema: opts.jsonSchema,
      n_probs: opts.nProbs,
      temperature: opts.generation.temperature,
      top_p: opts.generation.topP,
      top_k: opts.generation.topK,
      min_p: opts.generation.minP,
      ...(opts.generation.repetitionPenalty !== undefined
        ? { repeat_penalty: opts.generation.repetitionPenalty }
        : {}),
      ...(opts.generation.maxTokens !== undefined ? { n_predict: opts.generation.maxTokens } : {}),
      cache_prompt: true,
    }),
  });
  const latencyMs = Date.now() - startedAt;
  if (!res.ok) {
    throw new BackendError(`${baseUrl}/completion failed: HTTP ${res.status}`);
  }
  const raw = (await res.json()) as { content?: unknown };
  if (typeof raw.content !== "string") {
    throw new BackendError(`${baseUrl}/completion did not return a "content" string.`);
  }
  return { content: raw.content, raw, latencyMs };
}
