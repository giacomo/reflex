import http from "node:http";
import type { AddressInfo } from "node:net";

export interface ValueSpec {
  /** The exact substring in `content` this spec covers, e.g. the quoted answer value. */
  value: string;
  logprob: number;
  alternatives?: Array<[string, number]>;
}

/**
 * Splits `content` into tokens: each `spec.value` occurrence becomes its own
 * token carrying the given logprob/alternatives, and everything else becomes
 * "certain" filler tokens (logprob ~0, no real alternatives). Specs are
 * matched in the order given, each consuming its first remaining occurrence.
 */
export function tokenizeContent(
  content: string,
  specs: ValueSpec[],
): Array<{ token: string; logprob: number; alternatives?: Array<[string, number]> }> {
  const tokens: Array<{ token: string; logprob: number; alternatives?: Array<[string, number]> }> = [];
  let cursor = 0;
  for (const spec of specs) {
    const idx = content.indexOf(spec.value, cursor);
    if (idx < 0) throw new Error(`tokenizeContent: "${spec.value}" not found after position ${cursor}`);
    if (idx > cursor) {
      tokens.push({ token: content.slice(cursor, idx), logprob: -0.001 });
    }
    tokens.push({ token: spec.value, logprob: spec.logprob, alternatives: spec.alternatives ?? [] });
    cursor = idx + spec.value.length;
  }
  if (cursor < content.length) {
    tokens.push({ token: content.slice(cursor), logprob: -0.001 });
  }
  return tokens;
}

export interface FakeLlamaServer {
  url: string;
  requests: Array<{ path: string; body: unknown }>;
  close: () => Promise<void>;
}

export type CompletionResponder = (body: {
  prompt: string;
  json_schema: { properties: Record<string, { enum: string[] }> };
}) => { content: string; tokens: Array<{ token: string; logprob: number; alternatives?: Array<[string, number]> }> };

/** A fake llama-server exposing just the two endpoints reflex's core/backend.ts uses. */
export function startFakeLlamaServer(respond: CompletionResponder): Promise<FakeLlamaServer> {
  const requests: FakeLlamaServer["requests"] = [];

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      requests.push({ path: req.url ?? "", body });

      if (req.url === "/apply-template") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ prompt: JSON.stringify(body.messages) }));
        return;
      }

      if (req.url === "/completion") {
        const { content, tokens } = respond(body);
        const completion_probabilities = tokens.map((t) => ({
          token: t.token,
          logprob: t.logprob,
          top_logprobs: [
            { token: t.token, logprob: t.logprob },
            ...(t.alternatives ?? []).map(([token, logprob]) => ({ token, logprob })),
          ],
        }));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ content, completion_probabilities }));
        return;
      }

      res.writeHead(404).end();
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
