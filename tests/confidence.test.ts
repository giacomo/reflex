import { describe, expect, it } from "vitest";
import {
  extractTokenLogprobs,
  computeAnswerConfidence,
  type TokenLogprob,
} from "../src/core/confidence.js";

function entry(token: string, logprob: number, alts: Array<[string, number]> = []): TokenLogprob {
  return { token, logprob, topLogprobs: alts.map(([t, l]) => ({ token: t, logprob: l })) };
}

describe("extractTokenLogprobs", () => {
  it("parses a flat completion_probabilities array", () => {
    const response = {
      completion_probabilities: [
        { token: "ab", logprob: -0.1, top_logprobs: [{ token: "ab", logprob: -0.1 }] },
        { token: "cd", logprob: -0.2, top_logprobs: [{ token: "cd", logprob: -0.2 }] },
      ],
    };
    const tokens = extractTokenLogprobs(response);
    expect(tokens).toHaveLength(2);
    expect(tokens?.[0]?.token).toBe("ab");
  });

  it("flattens a nested { probs: [...] } shape", () => {
    const response = {
      completion_probabilities: [
        {
          content: "abcd",
          probs: [
            { token: "ab", logprob: -0.1, top_logprobs: [{ token: "ab", logprob: -0.1 }] },
            { token: "cd", logprob: -0.2, top_logprobs: [{ token: "cd", logprob: -0.2 }] },
          ],
        },
      ],
    };
    const tokens = extractTokenLogprobs(response);
    expect(tokens).toHaveLength(2);
  });

  it("returns undefined when the field is absent", () => {
    expect(extractTokenLogprobs({})).toBeUndefined();
  });

  it("returns undefined when entries are malformed", () => {
    const response = { completion_probabilities: [{ token: "x" }] };
    expect(extractTokenLogprobs(response)).toBeUndefined();
  });
});

describe("computeAnswerConfidence", () => {
  it("returns a high confidence for a dominant single-token answer", () => {
    const content = '{"mood":"happy"}';
    const tokens = buildTokensFor(content, { happy: -0.05 }, ["happy", "sad", "neutral"]);
    const confidence = computeAnswerConfidence(content, tokens, "mood", 1.0);
    expect(confidence).toBeGreaterThan(0.9);
  });

  it("returns a lower confidence when alternatives are close", () => {
    const content = '{"mood":"happy"}';
    const tokensClose = buildTokensForCloseAlternatives(content, "happy", ["happy", "sad"], -0.7, -0.72);
    const confidence = computeAnswerConfidence(content, tokensClose, "mood", 1.0);
    expect(confidence).toBeLessThan(0.6);
    expect(confidence).toBeGreaterThan(0.3);
  });

  it("applies temperature scaling: higher temperature flattens confidence toward uniform", () => {
    const content = '{"mood":"happy"}';
    const tokens = buildTokensFor(content, { happy: -0.05 }, ["happy", "sad", "neutral"]);
    const low = computeAnswerConfidence(content, tokens, "mood", 1.0)!;
    const high = computeAnswerConfidence(content, tokens, "mood", 5.0)!;
    expect(high).toBeLessThan(low);
  });

  it("returns undefined when the question is not present in content", () => {
    const content = '{"mood":"happy"}';
    const tokens = buildTokensFor(content, { happy: -0.05 }, ["happy"]);
    expect(computeAnswerConfidence(content, tokens, "does-not-exist", 1.0)).toBeUndefined();
  });

  it("returns undefined when tokens don't reconstruct content (misalignment)", () => {
    const content = '{"mood":"happy"}';
    const tokens = [entry("totally", -0.1, [["totally", -0.1]] as Array<[string, number]>)];
    expect(computeAnswerConfidence(content, tokens, "mood", 1.0)).toBeUndefined();
  });

  it("multiplies per-token probability across a multi-token answer", () => {
    // Split "happy" across two tokens: "hap" + "py".
    const content = '{"mood":"happy"}';
    const prefix = content.slice(0, content.indexOf("happy"));
    const suffix = content.slice(content.indexOf("happy") + "happy".length);
    const tokens = [
      entry(prefix, -0.01, [[prefix, -0.01]]),
      entry("hap", -0.1, [
        ["hap", -0.1],
        ["sad", -1.0],
      ]),
      entry("py", -0.05, [["py", -0.05]]),
      entry(suffix, -0.01, [[suffix, -0.01]]),
    ];
    const confidence = computeAnswerConfidence(content, tokens, "mood", 1.0);
    expect(confidence).toBeGreaterThan(0);
    expect(confidence).toBeLessThan(1);
  });
});

function buildTokensFor(
  content: string,
  chosen: Record<string, number>,
  allOptions: string[],
): TokenLogprob[] {
  const value = Object.keys(chosen)[0]!;
  const idx = content.indexOf(value);
  const prefix = content.slice(0, idx);
  const suffix = content.slice(idx + value.length);
  const alts: Array<[string, number]> = allOptions.map((opt) => [
    opt,
    opt === value ? chosen[value]! : chosen[value]! - 4,
  ]);
  return [
    entry(prefix, -0.01, [[prefix, -0.01]]),
    entry(value, chosen[value]!, alts),
    entry(suffix, -0.01, [[suffix, -0.01]]),
  ];
}

function buildTokensForCloseAlternatives(
  content: string,
  value: string,
  options: string[],
  chosenLogprob: number,
  altLogprob: number,
): TokenLogprob[] {
  const idx = content.indexOf(value);
  const prefix = content.slice(0, idx);
  const suffix = content.slice(idx + value.length);
  const alts: Array<[string, number]> = options.map((opt) => [
    opt,
    opt === value ? chosenLogprob : altLogprob,
  ]);
  return [
    entry(prefix, -0.01, [[prefix, -0.01]]),
    entry(value, chosenLogprob, alts),
    entry(suffix, -0.01, [[suffix, -0.01]]),
  ];
}
