import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { downloadFile, DownloadError, sha256File } from "../src/models/download.js";
import { startFakeHfServer, type FakeHfServer } from "./helpers/fake-hf-server.js";

const REPO = "acme/test-model";
const FILE = "model-Q4_K_M.gguf";

function sha256(content: Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

describe("downloadFile", () => {
  let server: FakeHfServer;
  let tmpDir: string;
  let content: Buffer;

  beforeEach(async () => {
    content = crypto.randomBytes(200_000);
    server = await startFakeHfServer({ [REPO]: { [FILE]: { content } } });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reflex-download-test-"));
  });

  afterEach(async () => {
    await server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("downloads a file and verifies its checksum", async () => {
    const dest = path.join(tmpDir, FILE);
    await downloadFile(`${server.url}/${REPO}/resolve/main/${FILE}`, dest, {
      expectedSha256: sha256(content),
      expectedSize: content.length,
    });
    expect(fs.readFileSync(dest)).toEqual(content);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
  });

  it("resumes an interrupted download via HTTP Range", async () => {
    const dest = path.join(tmpDir, FILE);
    const partial = content.subarray(0, 50_000);
    fs.writeFileSync(`${dest}.part`, partial);

    await downloadFile(`${server.url}/${REPO}/resolve/main/${FILE}`, dest, {
      expectedSha256: sha256(content),
      expectedSize: content.length,
    });

    expect(fs.readFileSync(dest)).toEqual(content);
    const rangeRequest = server.requestLog.find((r) => r.range !== undefined);
    expect(rangeRequest?.range).toBe(`bytes=50000-`);
  });

  it("reports progress with growing byte counts", async () => {
    const dest = path.join(tmpDir, FILE);
    const seen: number[] = [];
    await downloadFile(`${server.url}/${REPO}/resolve/main/${FILE}`, dest, {
      onProgress: (p) => seen.push(p.downloadedBytes),
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe(content.length);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    }
  });

  it("deletes the partial file and throws on checksum mismatch", async () => {
    const dest = path.join(tmpDir, FILE);
    await expect(
      downloadFile(`${server.url}/${REPO}/resolve/main/${FILE}`, dest, {
        expectedSha256: "0".repeat(64),
      }),
    ).rejects.toThrow(DownloadError);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
    expect(fs.existsSync(dest)).toBe(false);
  });

  it("deletes the partial file and throws on size mismatch", async () => {
    const dest = path.join(tmpDir, FILE);
    await expect(
      downloadFile(`${server.url}/${REPO}/resolve/main/${FILE}`, dest, {
        expectedSize: content.length + 1,
      }),
    ).rejects.toThrow(DownloadError);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
  });

  it("throws a clear error for a 404", async () => {
    const dest = path.join(tmpDir, "missing.gguf");
    await expect(
      downloadFile(`${server.url}/${REPO}/resolve/main/does-not-exist.gguf`, dest, {}),
    ).rejects.toThrow(DownloadError);
  });
});

describe("sha256File", () => {
  it("matches Node's own crypto digest", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reflex-sha-test-"));
    const file = path.join(tmpDir, "x.bin");
    const content = crypto.randomBytes(1000);
    fs.writeFileSync(file, content);
    expect(await sha256File(file)).toBe(sha256(content));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
