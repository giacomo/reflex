import { describe, expect, it, afterEach } from "vitest";
import * as reflex from "../src/index.js";
import { startFakeLlamaServer, tokenizeContent, type FakeLlamaServer } from "./helpers/fake-llama-server.js";

describe("public library entry point", () => {
  let fast: FakeLlamaServer | undefined;
  let deep: FakeLlamaServer | undefined;

  afterEach(async () => {
    await fast?.close();
    await deep?.close();
  });

  it("exposes decide() and the config defaults", async () => {
    expect(typeof reflex.decide).toBe("function");
    expect(reflex.DEFAULT_CONFIG.router.threshold).toBe(0.8);

    fast = await startFakeLlamaServer(() => {
      const content = '{"mood":"happy"}';
      return { content, tokens: tokenizeContent(content, [{ value: "happy", logprob: -0.01, alternatives: [] }]) };
    });
    deep = await startFakeLlamaServer(() => ({ content: "{}", tokens: [] }));

    const schema = reflex.parseDecisionSchema({
      questions: [{ name: "mood", options: ["happy", "sad"] }],
    });
    const result = await reflex.decide({
      fastBaseUrl: fast.url,
      deepBaseUrl: deep.url,
      schema,
      state: "fine",
      router: reflex.DEFAULT_CONFIG.router,
      fastGeneration: reflex.DEFAULT_CONFIG.fast,
      deepGeneration: reflex.DEFAULT_CONFIG.deep,
    });
    expect(result.results[0]?.answer).toBe("happy");
  });
});
