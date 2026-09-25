import http from "node:http";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";

export interface FakeRepoFile {
  content: Buffer;
  /** Override the advertised sha256; defaults to the real hash of `content`. */
  sha256?: string;
  /** Simulate a non-LFS file with no sha256 available at all. */
  noLfs?: boolean;
}

export interface FakeHfServer {
  url: string;
  requestLog: Array<{ method: string; path: string; range: string | undefined }>;
  close: () => Promise<void>;
}

/**
 * A minimal stand-in for the two Hugging Face HTTP endpoints reflex uses:
 * `GET /api/models/{repo}/tree/main` and `GET /{repo}/resolve/main/{file}`
 * (the latter with HTTP Range support, so download resumption can be tested
 * without hitting the real Hugging Face servers).
 */
export function startFakeHfServer(
  repos: Record<string, Record<string, FakeRepoFile>>,
): Promise<FakeHfServer> {
  const requestLog: FakeHfServer["requestLog"] = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    requestLog.push({
      method: req.method ?? "GET",
      path: url.pathname,
      range: req.headers.range,
    });

    const treeMatch = /^\/api\/models\/(.+)\/tree\/main$/.exec(url.pathname);
    if (treeMatch?.[1]) {
      const repo = decodeURIComponent(treeMatch[1]);
      const files = repos[repo];
      if (!files) {
        res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({}));
        return;
      }
      const entries = Object.entries(files).map(([path, f]) => ({
        type: "file",
        path,
        size: f.content.length,
        oid: crypto.createHash("sha1").update(f.content).digest("hex"),
        ...(f.noLfs
          ? {}
          : { lfs: { oid: f.sha256 ?? sha256Of(f.content), size: f.content.length } }),
      }));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(entries));
      return;
    }

    const resolveMatch = /^\/(.+)\/resolve\/main\/(.+)$/.exec(url.pathname);
    if (resolveMatch?.[1] && resolveMatch[2]) {
      const repo = decodeURIComponent(resolveMatch[1]);
      const fileName = decodeURIComponent(resolveMatch[2]);
      const file = repos[repo]?.[fileName];
      if (!file) {
        res.writeHead(404).end("not found");
        return;
      }
      serveWithRange(req, res, file.content);
      return;
    }

    res.writeHead(404).end("not found");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requestLog,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function sha256Of(content: Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function serveWithRange(req: http.IncomingMessage, res: http.ServerResponse, content: Buffer) {
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": content.length,
    });
    res.end(content);
    return;
  }
  const match = /^bytes=(\d+)-$/.exec(range);
  const start = match?.[1] ? Number(match[1]) : 0;
  if (start >= content.length) {
    res.writeHead(416, { "content-range": `bytes */${content.length}` }).end();
    return;
  }
  const chunk = content.subarray(start);
  res.writeHead(206, {
    "content-type": "application/octet-stream",
    "content-range": `bytes ${start}-${content.length - 1}/${content.length}`,
    "content-length": chunk.length,
  });
  res.end(chunk);
}
