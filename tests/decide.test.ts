import { describe, expect, it, afterEach } from "vitest";
import { decide, DecideError } from "../src/core/decide.js";
import { parseDecisionSchema } from "../src/core/schema.js";
import { ConfigSchema } from "../src/config.js";
import { startFakeLlamaServer, tokenizeContent, type FakeLlamaServer } from "./helpers/fake-llama-server.js";

const schema = parseDecisionSchema({
  questions: [
    { name: "mood", options: ["happy", "sad"] },
    { name: "urgent", options: ["yes", "no"] },
  ],
});

const defaults = ConfigSchema.parse({});

describe("decide", () => {
  let fast: FakeLlamaServer | undefined;
  let deep: FakeLlamaServer | undefined;

  afterEach(async () => {
    await fast?.close();
    await deep?.close();
    fast = undefined;
    deep = undefined;
  });

  it("accepts confident fast answers and escalates only the low-confidence one", async () => {
    fast = await startFakeLlamaServer(() => {
      const content = '{"mood":"happy","urgent":"yes"}';
      const tokens = tokenizeContent(content, [
        { value: "happy", logprob: -0.01, alternatives: [["sad", -6]] },
        // "urgent" is a coin flip between yes/no: low confidence.
        { value: "yes", logprob: -0.7, alternatives: [["no", -0.72]] },
      ]);
      return { content, tokens };
    });
    deep = await startFakeLlamaServer(() => {
      const content = '{"urgent":"no"}';
      const tokens = tokenizeContent(content, [{ value: "no", logprob: -0.01, alternatives: [["yes", -6]] }]);
      return { content, tokens };
    });

    const result = await decide({
      fastBaseUrl: fast.url,
      deepBaseUrl: deep.url,
      schema,
      state: "user seems okay",
      router: defaults.router,
      fastGeneration: defaults.fast,
      deepGeneration: defaults.deep,
    });

    expect(result.results.map((r) => r.name)).toEqual(["mood", "urgent"]);
    const mood = result.results.find((r) => r.name === "mood")!;
    const urgent = result.results.find((r) => r.name === "urgent")!;
    expect(mood.decidedBy).toBe("fast");
    expect(mood.answer).toBe("happy");
    expect(mood.confidence).toBeGreaterThan(0.9);
    expect(urgent.decidedBy).toBe("deep");
    expect(urgent.answer).toBe("no");
    expect(result.escalationRate).toBe(0.5);
  });

  it("does not escalate when both answers are confident", async () => {
    fast = await startFakeLlamaServer(() => {
      const content = '{"mood":"happy","urgent":"no"}';
      const tokens = tokenizeContent(content, [
        { value: "happy", logprob: -0.01, alternatives: [["sad", -6]] },
        { value: "no", logprob: -0.01, alternatives: [["yes", -6]] },
      ]);
      return { content, tokens };
    });
    deep = await startFakeLlamaServer(() => {
      throw new Error("deep layer should not be called");
    });

    const result = await decide({
      fastBaseUrl: fast.url,
      deepBaseUrl: deep.url,
      schema,
      state: "fine",
      router: defaults.router,
      fastGeneration: defaults.fast,
      deepGeneration: defaults.deep,
    });

    expect(result.escalationRate).toBe(0);
    expect(result.results.every((r) => r.decidedBy === "fast")).toBe(true);
  });

  it("respects onMissingConfidence: accept (no logprobs, don't escalate)", async () => {
    fast = await startFakeLlamaServer(() => ({
      content: '{"mood":"happy","urgent":"no"}',
      tokens: [], // no completion_probabilities => confidence extraction fails
    }));
    deep = await startFakeLlamaServer(() => {
      throw new Error("deep layer should not be called");
    });

    const router = ConfigSchema.parse({ router: { onMissingConfidence: "accept" } }).router;
    const result = await decide({
      fastBaseUrl: fast.url,
      deepBaseUrl: deep.url,
      schema,
      state: "fine",
      router,
      fastGeneration: defaults.fast,
      deepGeneration: defaults.deep,
    });

    expect(result.escalationRate).toBe(0);
    expect(result.results.every((r) => r.confidence === null)).toBe(true);
  });

  it("respects onMissingConfidence: escalate (the default)", async () => {
    fast = await startFakeLlamaServer(() => ({
      content: '{"mood":"happy","urgent":"no"}',
      tokens: [],
    }));
    deep = await startFakeLlamaServer((body) => {
      const key = Object.keys(body.json_schema.properties)[0]!;
      const value = key === "mood" ? "happy" : "no";
      const content = `{"${key}":"${value}"}`;
      return { content, tokens: tokenizeContent(content, [{ value, logprob: -0.01 }]) };
    });

    const result = await decide({
      fastBaseUrl: fast.url,
      deepBaseUrl: deep.url,
      schema,
      state: "fine",
      router: defaults.router,
      fastGeneration: defaults.fast,
      deepGeneration: defaults.deep,
    });

    expect(result.escalationRate).toBe(1);
    expect(result.results.every((r) => r.decidedBy === "deep")).toBe(true);
  });

  it("throws DecideError when the backend returns invalid JSON", async () => {
    fast = await startFakeLlamaServer(() => ({ content: "not json", tokens: [] }));
    deep = await startFakeLlamaServer(() => ({ content: "{}", tokens: [] }));

    await expect(
      decide({
        fastBaseUrl: fast.url,
        deepBaseUrl: deep.url,
        schema,
        state: "fine",
        router: defaults.router,
        fastGeneration: defaults.fast,
        deepGeneration: defaults.deep,
      }),
    ).rejects.toThrow(DecideError);
  });

  it("escalates a question whose fast answer isn't one of the allowed options", async () => {
    fast = await startFakeLlamaServer(() => {
      const content = '{"mood":"ecstatic","urgent":"no"}';
      return {
        content,
        tokens: tokenizeContent(content, [
          { value: "ecstatic", logprob: -0.01 },
          { value: "no", logprob: -0.01, alternatives: [["yes", -6]] },
        ]),
      };
    });
    deep = await startFakeLlamaServer(() => {
      const content = '{"mood":"happy"}';
      return { content, tokens: tokenizeContent(content, [{ value: "happy", logprob: -0.01 }]) };
    });

    const result = await decide({
      fastBaseUrl: fast.url,
      deepBaseUrl: deep.url,
      schema,
      state: "fine",
      router: defaults.router,
      fastGeneration: defaults.fast,
      deepGeneration: defaults.deep,
    });

    const mood = result.results.find((r) => r.name === "mood")!;
    expect(mood.decidedBy).toBe("deep");
    expect(mood.answer).toBe("happy");
  });
});
