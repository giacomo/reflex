/**
 * Confidence extraction from llama-server's `/completion` response.
 *
 * The fork's tools/server/README.md documents `n_probs` producing a
 * `completion_probabilities` array (one entry per generated token) where
 * each entry carries the chosen token's logprob and a `top_logprobs` list of
 * alternatives. This module is deliberately defensive about the exact
 * nesting (the doc's own example is ambiguous about whether entries sit
 * directly in the array or one level down under a `probs` field) and about
 * the field's absence entirely: if `n_probs` isn't honored by a given
 * backend, extraction returns `undefined` and callers apply
 * `onMissingConfidence`, per the config, rather than guessing a number.
 */

export interface TokenLogprob {
  token: string;
  logprob: number;
  topLogprobs: Array<{ token: string; logprob: number }>;
}

interface RawTokenEntry {
  token?: unknown;
  logprob?: unknown;
  top_logprobs?: unknown;
}

function parseRawEntry(entry: unknown): TokenLogprob | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;
  const e = entry as RawTokenEntry;
  if (typeof e.token !== "string" || typeof e.logprob !== "number" || !Array.isArray(e.top_logprobs)) {
    return undefined;
  }
  const topLogprobs = e.top_logprobs
    .map((alt) => {
      if (typeof alt !== "object" || alt === null) return undefined;
      const a = alt as RawTokenEntry;
      if (typeof a.token !== "string" || typeof a.logprob !== "number") return undefined;
      return { token: a.token, logprob: a.logprob };
    })
    .filter((x): x is { token: string; logprob: number } => x !== undefined);
  return { token: e.token, logprob: e.logprob, topLogprobs };
}

export function extractTokenLogprobs(response: unknown): TokenLogprob[] | undefined {
  if (typeof response !== "object" || response === null) return undefined;
  const raw = (response as { completion_probabilities?: unknown }).completion_probabilities;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  const flat: unknown[] = [];
  for (const item of raw) {
    if (item !== null && typeof item === "object" && Array.isArray((item as { probs?: unknown }).probs)) {
      flat.push(...(item as { probs: unknown[] }).probs);
    } else {
      flat.push(item);
    }
  }

  const parsed = flat.map(parseRawEntry);
  if (parsed.some((p) => p === undefined)) return undefined;
  return parsed as TokenLogprob[];
}

/**
 * Renormalizes a chosen token's logprob against only the top-N alternatives
 * llama-server returned (not the full vocabulary, which top_logprobs doesn't
 * expose), then applies temperature scaling within that truncated set. This
 * is an approximation of full-vocabulary temperature-scaled calibration —
 * documented as such in the README's Nuance section — not the exact method.
 */
function calibratedProbability(entry: TokenLogprob, temperature: number): number {
  const alternatives = entry.topLogprobs.some((a) => a.token === entry.token)
    ? entry.topLogprobs
    : [...entry.topLogprobs, { token: entry.token, logprob: entry.logprob }];
  const scaled = alternatives.map((a) => a.logprob / temperature);
  const max = Math.max(...scaled);
  const weights = scaled.map((s) => Math.exp(s - max));
  const sum = weights.reduce((a, b) => a + b, 0);
  const chosenIndex = alternatives.findIndex((a) => a.token === entry.token);
  return weights[chosenIndex]! / sum;
}

/**
 * Finds the char range of `"questionName": "<value>"` inside the generated
 * JSON `content`, maps it onto the token sequence by cumulative text length,
 * and returns the joint calibrated probability of the tokens spanning the
 * answer value. Returns undefined if the question isn't found in content or
 * the token texts don't reconstruct it (defensive against drift between
 * `content` and the token list).
 */
export function computeAnswerConfidence(
  content: string,
  tokens: TokenLogprob[],
  questionName: string,
  temperature: number,
): number | undefined {
  const escaped = questionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`"${escaped}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(content);
  if (!match || match.index === undefined || match[1] === undefined) return undefined;
  const valueStart = match.index + match[0].indexOf(match[1], match[0].indexOf(":"));
  const valueEnd = valueStart + match[1].length;

  const reconstructed = tokens.map((t) => t.token).join("");
  if (!reconstructed.startsWith(content)) {
    // Token texts don't reconstruct the content we parsed the answer from;
    // don't fabricate a confidence number from a misaligned token span.
    return undefined;
  }

  let offset = 0;
  const spanned: TokenLogprob[] = [];
  for (const t of tokens) {
    const start = offset;
    const end = offset + t.token.length;
    if (end > valueStart && start < valueEnd) {
      spanned.push(t);
    }
    offset = end;
  }
  if (spanned.length === 0) return undefined;

  const probabilities = spanned.map((t) => calibratedProbability(t, temperature));
  return probabilities.reduce((a, b) => a * b, 1);
}

/** Convenience wrapper: extracts logprobs from a raw /completion response and scores one question. */
export function confidenceFor(
  raw: unknown,
  content: string,
  questionName: string,
  temperature: number,
): number | undefined {
  const tokens = extractTokenLogprobs(raw);
  if (!tokens) return undefined;
  return computeAnswerConfidence(content, tokens, questionName, temperature);
}
