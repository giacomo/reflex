import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolvePrebuiltAsset,
  installPrebuilt,
  computeAssetName,
  parseBuildNumber,
  MIN_BUILD_NUMBER,
  PrebuiltError,
} from "../src/runtime/prebuilt.js";
import { readLock } from "../src/runtime/lock.js";
import { createTestArchive } from "./helpers/test-archive.js";
import { startFakeGithubServer, type FakeGithubServer } from "./helpers/fake-github-server.js";

describe("parseBuildNumber", () => {
  it("parses a b-tagged build number", () => {
    expect(parseBuildNumber("b11188")).toBe(11188);
  });

  it("returns undefined for non-build tags", () => {
    expect(parseBuildNumber("v0.5.0")).toBeUndefined();
    expect(parseBuildNumber("b11188-rc1")).toBeUndefined();
  });
});

describe("computeAssetName", () => {
  it("produces the platform-specific asset name for the current process", () => {
    const name = computeAssetName("b11188");
    if (process.platform === "win32") {
      expect(name).toMatch(/^llama-b11188-bin-win-cpu-(x64|arm64)\.zip$/);
    } else if (process.platform === "darwin") {
      expect(name).toMatch(/^llama-b11188-bin-macos-(x64|arm64)\.tar\.gz$/);
    } else if (process.platform === "linux") {
      expect(name).toMatch(/^llama-b11188-bin-ubuntu-(x64|arm64)\.tar\.gz$/);
    }
  });
});

function buildFixture(dir: string): { archivePath: string; binaryName: string } {
  const binaryName = process.platform === "win32" ? "llama-server.exe" : "llama-server";
  const archivePath = path.join(dir, process.platform === "win32" ? "asset.zip" : "asset.tar.gz");
  // Mimic the real Linux/macOS release layout: files wrapped in a top-level folder.
  createTestArchive(archivePath, {
    [`llama-b11188/${binaryName}`]: "#!/bin/sh\necho fake llama-server\n",
    "llama-b11188/ggml-base.dll": "fake",
  });
  return { archivePath, binaryName };
}

describe("resolvePrebuiltAsset", () => {
  let server: FakeGithubServer;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reflex-prebuilt-test-"));
  });

  afterEach(async () => {
    await server?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("picks the newest release at or above the minimum build number", async () => {
    const { archivePath } = buildFixture(tmpDir);
    const assetName = computeAssetName("b11188");
    server = await startFakeGithubServer([
      { tag_name: "v0.5.0", assets: [] },
      { tag_name: "b11188", assets: [{ name: assetName, filePath: archivePath }] },
      { tag_name: "b9999", assets: [{ name: computeAssetName("b9999"), filePath: archivePath }] },
    ]);

    const asset = await resolvePrebuiltAsset({ apiBase: server.url });
    expect(asset.tag).toBe("b11188");
    expect(asset.assetName).toBe(assetName);
    expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(asset.size).toBe(fs.statSync(archivePath).size);
  });

  it("throws when no release meets the minimum build number", async () => {
    server = await startFakeGithubServer([{ tag_name: "b100", assets: [] }]);
    await expect(resolvePrebuiltAsset({ apiBase: server.url })).rejects.toThrow(PrebuiltError);
  });

  it("throws when the compatible release has no matching asset", async () => {
    server = await startFakeGithubServer([{ tag_name: `b${MIN_BUILD_NUMBER}`, assets: [] }]);
    await expect(resolvePrebuiltAsset({ apiBase: server.url })).rejects.toThrow(PrebuiltError);
  });
});

describe("installPrebuilt", () => {
  let server: FakeGithubServer;
  let sourceDir: string;
  let runtimeDir: string;

  beforeEach(() => {
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "reflex-prebuilt-src-"));
    runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "reflex-prebuilt-runtime-"));
  });

  afterEach(async () => {
    await server?.close();
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });

  it("downloads, verifies, extracts, and locates the binary", async () => {
    const { archivePath, binaryName } = buildFixture(sourceDir);
    const assetName = computeAssetName("b11188");
    server = await startFakeGithubServer([{ tag_name: "b11188", assets: [{ name: assetName, filePath: archivePath }] }]);

    const lock = await installPrebuilt(runtimeDir, { apiBase: server.url });

    expect(lock.source).toBe("prebuilt");
    expect(lock.tag).toBe("b11188");
    expect(fs.existsSync(lock.binaryPath)).toBe(true);
    expect(path.basename(lock.binaryPath)).toBe(binaryName);
    expect(readLock(runtimeDir)).toEqual(lock);
  });

  it("is idempotent: a second call doesn't hit the network again", async () => {
    const { archivePath } = buildFixture(sourceDir);
    const assetName = computeAssetName("b11188");
    server = await startFakeGithubServer([{ tag_name: "b11188", assets: [{ name: assetName, filePath: archivePath }] }]);

    await installPrebuilt(runtimeDir, { apiBase: server.url });
    const requestsAfterFirst = server.requestCount;

    const lock = await installPrebuilt(runtimeDir, { apiBase: server.url });
    expect(server.requestCount).toBe(requestsAfterFirst);
    expect(lock.tag).toBe("b11188");
  });

  it("re-downloads when force is set", async () => {
    const { archivePath } = buildFixture(sourceDir);
    const assetName = computeAssetName("b11188");
    server = await startFakeGithubServer([{ tag_name: "b11188", assets: [{ name: assetName, filePath: archivePath }] }]);

    await installPrebuilt(runtimeDir, { apiBase: server.url });
    const requestsAfterFirst = server.requestCount;

    await installPrebuilt(runtimeDir, { apiBase: server.url, force: true });
    expect(server.requestCount).toBeGreaterThan(requestsAfterFirst);
  });
});
