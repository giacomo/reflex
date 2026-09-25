import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  pullModel,
  listLocalModels,
  removeModel,
  getLocalModelPath,
} from "../src/models/manager.js";
import { startFakeHfServer, type FakeHfServer } from "./helpers/fake-hf-server.js";

const REPO = "acme/test-model";
const FILE = "test-model-Q4_K_M.gguf";

describe("model manager", () => {
  let server: FakeHfServer;
  let cacheDir: string;
  let content: Buffer;

  beforeEach(async () => {
    content = crypto.randomBytes(50_000);
    server = await startFakeHfServer({
      [REPO]: {
        [FILE]: { content },
        "test-model-F16.gguf": { content: crypto.randomBytes(80_000) },
      },
    });
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "reflex-manager-test-"));
    process.env["REFLEX_CACHE_DIR"] = cacheDir;
  });

  afterEach(async () => {
    await server.close();
    delete process.env["REFLEX_CACHE_DIR"];
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it("downloads the preferred quant and writes a manifest", async () => {
    const result = await pullModel("test-model", {
      unsafeRepo: REPO,
      yes: true,
      hf: { endpoint: server.url },
    });
    expect(result.status).toBe("downloaded");
    if (result.status !== "downloaded") throw new Error("unreachable");
    expect(result.manifest.file).toBe(FILE);
    expect(result.manifest.sizeBytes).toBe(content.length);

    const localPath = getLocalModelPath("test-model");
    expect(localPath).toBeDefined();
    expect(fs.readFileSync(localPath!)).toEqual(content);
  });

  it("is idempotent: a second pull does not hit the network again", async () => {
    await pullModel("test-model", { unsafeRepo: REPO, yes: true, hf: { endpoint: server.url } });
    const requestsAfterFirst = server.requestLog.length;

    const second = await pullModel("test-model", {
      unsafeRepo: REPO,
      yes: true,
      hf: { endpoint: server.url },
    });
    expect(second.status).toBe("already-present");
    expect(server.requestLog.length).toBe(requestsAfterFirst);
  });

  it("cancels without downloading when confirm() returns false", async () => {
    const result = await pullModel("test-model", {
      unsafeRepo: REPO,
      hf: { endpoint: server.url },
      confirm: () => false,
    });
    expect(result.status).toBe("cancelled");
    expect(getLocalModelPath("test-model")).toBeUndefined();
  });

  it("passes size and file name to the confirmation callback", async () => {
    let seen: { file: string; sizeBytes: number } | undefined;
    await pullModel("test-model", {
      unsafeRepo: REPO,
      hf: { endpoint: server.url },
      confirm: (info) => {
        seen = info;
        return true;
      },
    });
    expect(seen?.file).toBe(FILE);
    expect(seen?.sizeBytes).toBe(content.length);
  });

  it("lists and removes local models", async () => {
    await pullModel("test-model", { unsafeRepo: REPO, yes: true, hf: { endpoint: server.url } });
    expect(listLocalModels().map((m) => m.name)).toEqual(["test-model"]);

    expect(removeModel("test-model")).toBe(true);
    expect(listLocalModels()).toEqual([]);
    expect(getLocalModelPath("test-model")).toBeUndefined();
    expect(removeModel("test-model")).toBe(false);
  });
});
