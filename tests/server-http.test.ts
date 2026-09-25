import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import type http from "node:http";
import { createServer, assertLoopbackHost, ServerBindError } from "../src/server/http.js";
import { ConfigSchema } from "../src/config.js";
import { startFakeLlamaServer, tokenizeContent, type FakeLlamaServer } from "./helpers/fake-llama-server.js";

async function post(url: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe("assertLoopbackHost", () => {
  it("accepts loopback hosts", () => {
    expect(() => assertLoopbackHost("127.0.0.1")).not.toThrow();
    expect(() => assertLoopbackHost("localhost")).not.toThrow();
    expect(() => assertLoopbackHost("::1")).not.toThrow();
  });

  it("rejects any non-loopback host", () => {
    expect(() => assertLoopbackHost("0.0.0.0")).toThrow(ServerBindError);
    expect(() => assertLoopbackHost("192.168.1.5")).toThrow(ServerBindError);
  });
});

describe("reflex serve HTTP API", () => {
  let fast: FakeLlamaServer;
  let deep: FakeLlamaServer;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    fast = await startFakeLlamaServer(() => {
      const content = '{"mood":"happy"}';
      return { content, tokens: tokenizeContent(content, [{ value: "happy", logprob: -0.01, alternatives: [] }]) };
    });
    deep = await startFakeLlamaServer(() => ({ content: "{}", tokens: [] }));

    const config = ConfigSchema.parse({ ports: { fast: portOf(fast), deep: portOf(deep) } });
    server = createServer(config);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await fast.close();
    await deep.close();
    await new Promise((resolve) => server.close(resolve));
  });

  function portOf(s: FakeLlamaServer): number {
    return Number(new URL(s.url).port);
  }

  it("GET /health returns ok", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("POST /decide returns a decision result", async () => {
    const { status, json } = await post(`${baseUrl}/decide`, {
      schema: { questions: [{ name: "mood", options: ["happy", "sad"] }] },
      state: "fine",
    });
    expect(status).toBe(200);
    expect(json).toMatchObject({
      results: [{ name: "mood", answer: "happy", decidedBy: "fast" }],
    });
  });

  it("POST /decide with an invalid schema returns 400", async () => {
    const { status, json } = await post(`${baseUrl}/decide`, { schema: { questions: [] }, state: "x" });
    expect(status).toBe(400);
    expect(json).toHaveProperty("error");
  });

  it("POST /decide with malformed JSON returns 400", async () => {
    const res = await fetch(`${baseUrl}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    expect(res.status).toBe(400);
  });

  it("GET / serves the HTML playground page", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const text = await res.text();
    expect(text).toContain("<title>reflex</title>");
    expect(text).toContain("/decide");
  });

  it("GET /playground also serves the same page", async () => {
    const res = await fetch(`${baseUrl}/playground`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("unknown routes return 404", async () => {
    const res = await fetch(`${baseUrl}/nope`);
    expect(res.status).toBe(404);
  });
});
