import http from "node:http";
import type { ReflexConfig } from "../config.js";
import { parseDecisionSchema, SchemaError } from "../core/schema.js";
import { decide, DecideError } from "../core/decide.js";
import { BackendError } from "../core/backend.js";
import { serverHandle } from "../runtime/orchestrator.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export class ServerBindError extends Error {}

/** Refuses to serve on anything but loopback: reflex has no auth and is meant to stay local-only. */
export function assertLoopbackHost(host: string): void {
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new ServerBindError(
      `refusing to bind "server.host: ${host}" — reflex serve only binds to localhost ` +
        `(127.0.0.1, localhost, or ::1) since it has no authentication.`,
    );
  }
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk));
    req.on("end", () => {
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new SchemaError(`Request body is not valid JSON: ${(err as Error).message}`));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

interface DecideRequestBody {
  schema?: unknown;
  state?: unknown;
}

export function createRequestListener(config: ReflexConfig): http.RequestListener {
  return (req, res) => {
    void handleRequest(config, req, res).catch((err: unknown) => {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
  };
}

async function handleRequest(
  config: ReflexConfig,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (req.method === "POST" && req.url === "/decide") {
    let body: DecideRequestBody;
    try {
      body = ((await readJsonBody(req)) ?? {}) as DecideRequestBody;
    } catch (err) {
      sendJson(res, 400, { error: (err as Error).message });
      return;
    }

    let schema;
    try {
      schema = parseDecisionSchema(body.schema);
    } catch (err) {
      sendJson(res, 400, { error: (err as Error).message });
      return;
    }

    const state = typeof body.state === "string" || (typeof body.state === "object" && body.state !== null)
      ? (body.state as string | Record<string, unknown>)
      : "";

    try {
      const fastHandle = serverHandle(config, "fast");
      const deepHandle = serverHandle(config, "deep");
      const result = await decide({
        fastBaseUrl: fastHandle.baseUrl,
        deepBaseUrl: deepHandle.baseUrl,
        schema,
        state,
        router: config.router,
        fastGeneration: config.fast,
        deepGeneration: config.deep,
      });
      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof DecideError || err instanceof BackendError) {
        sendJson(res, 502, { error: err.message });
        return;
      }
      throw err;
    }
    return;
  }

  sendJson(res, 404, { error: "not found" });
}

export function createServer(config: ReflexConfig): http.Server {
  assertLoopbackHost(config.server.host);
  return http.createServer(createRequestListener(config));
}
