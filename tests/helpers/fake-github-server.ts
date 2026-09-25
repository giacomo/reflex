import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";

export interface FakeGithubAsset {
  name: string;
  filePath: string;
}

export interface FakeGithubRelease {
  tag_name: string;
  assets: FakeGithubAsset[];
}

export interface FakeGithubServer {
  url: string;
  requestCount: number;
  close: () => Promise<void>;
}

/** Stands in for the GitHub releases API + asset downloads used by prebuilt.ts. */
export function startFakeGithubServer(releases: FakeGithubRelease[]): Promise<FakeGithubServer> {
  const state = { requestCount: 0 };

  const server: http.Server = http.createServer((req, res) => {
    state.requestCount++;
    const url = new URL(req.url ?? "/", "http://localhost");
    const port = (server.address() as AddressInfo).port;

    if (url.pathname === "/repos/ggml-org/llama.cpp/releases") {
      const body = releases.map((r) => ({
        tag_name: r.tag_name,
        assets: r.assets.map((a) => {
          const content = fs.readFileSync(a.filePath);
          const digest = `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
          return {
            name: a.name,
            size: content.length,
            digest,
            browser_download_url: `http://127.0.0.1:${port}/download/${encodeURIComponent(a.name)}`,
          };
        }),
      }));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }

    const downloadMatch = /^\/download\/(.+)$/.exec(url.pathname);
    if (downloadMatch?.[1]) {
      const assetName = decodeURIComponent(downloadMatch[1]);
      const asset = releases.flatMap((r) => r.assets).find((a) => a.name === assetName);
      if (!asset) {
        res.writeHead(404).end();
        return;
      }
      const content = fs.readFileSync(asset.filePath);
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": content.length });
      res.end(content);
      return;
    }

    res.writeHead(404).end();
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/repos/ggml-org/llama.cpp`,
        get requestCount() {
          return state.requestCount;
        },
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
