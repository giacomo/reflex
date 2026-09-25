import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { downloadFile, type DownloadProgress } from "../models/download.js";
import { readLock, writeLock, type PrebuiltLock } from "./lock.js";

export class PrebuiltError extends Error {}

const REPO = "ggml-org/llama.cpp";
const GITHUB_API_BASE = `https://api.github.com/repos/${REPO}`;

/**
 * The Spark-X2.5-4B-GGUF model card states native `spark2_5` support
 * requires llama.cpp build b10828 or later. Mainline ggml-org/llama.cpp has
 * since merged that architecture (confirmed present in gguf-py/constants.py
 * as MODEL_ARCH.SPARK2_5), so its official prebuilt releases work for both
 * models reflex uses -- no need to build the XHToken fork from source.
 */
export const MIN_BUILD_NUMBER = 10828;

interface GhAsset {
  name: string;
  size: number;
  digest?: string;
  browser_download_url: string;
}
interface GhRelease {
  tag_name: string;
  assets: GhAsset[];
}

export interface PrebuiltAsset {
  repo: string;
  tag: string;
  assetName: string;
  downloadUrl: string;
  sha256: string | undefined;
  size: number;
}

export function parseBuildNumber(tag: string): number | undefined {
  const match = /^b(\d+)$/.exec(tag);
  return match?.[1] ? Number(match[1]) : undefined;
}

export function computeAssetName(tag: string): string {
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : undefined;
  if (!arch) {
    throw new PrebuiltError(
      `${REPO} does not publish a prebuilt llama-server for architecture "${process.arch}"; build from source instead.`,
    );
  }
  if (process.platform === "win32") return `llama-${tag}-bin-win-cpu-${arch}.zip`;
  if (process.platform === "darwin") return `llama-${tag}-bin-macos-${arch}.tar.gz`;
  if (process.platform === "linux") return `llama-${tag}-bin-ubuntu-${arch}.tar.gz`;
  throw new PrebuiltError(
    `${REPO} does not publish a prebuilt llama-server for platform "${process.platform}"; build from source instead.`,
  );
}

/**
 * Finds the newest ggml-org/llama.cpp release build (tag `bNNNN`) at or
 * above MIN_BUILD_NUMBER and resolves the platform/arch-specific asset for
 * it. Always uses the latest compatible build rather than a pinned one --
 * these nightly-style builds are meant to always work.
 */
export async function resolvePrebuiltAsset(opts: { apiBase?: string } = {}): Promise<PrebuiltAsset> {
  const apiBase = opts.apiBase ?? GITHUB_API_BASE;
  const res = await fetch(`${apiBase}/releases?per_page=10`, {
    headers: { accept: "application/vnd.github+json" },
  });
  if (!res.ok) {
    throw new PrebuiltError(`Failed to list ${REPO} releases: HTTP ${res.status}`);
  }
  const releases = (await res.json()) as GhRelease[];
  const withBuildNumbers = releases
    .map((release) => ({ release, buildNumber: parseBuildNumber(release.tag_name) }))
    .filter((r): r is { release: GhRelease; buildNumber: number } => r.buildNumber !== undefined)
    .sort((a, b) => b.buildNumber - a.buildNumber);

  const compatible = withBuildNumbers.find((r) => r.buildNumber >= MIN_BUILD_NUMBER);
  if (!compatible) {
    throw new PrebuiltError(
      `No ${REPO} release at or above b${MIN_BUILD_NUMBER} was found (that's the minimum with native ` +
        "Spark2_5 support). Build the XHToken fork from source instead.",
    );
  }

  const assetName = computeAssetName(compatible.release.tag_name);
  const asset = compatible.release.assets.find((a) => a.name === assetName);
  if (!asset) {
    throw new PrebuiltError(
      `Release ${compatible.release.tag_name} has no "${assetName}" asset for ${process.platform}/${process.arch}.`,
    );
  }
  const sha256 = asset.digest?.startsWith("sha256:") ? asset.digest.slice("sha256:".length) : undefined;
  return {
    repo: REPO,
    tag: compatible.release.tag_name,
    assetName: asset.name,
    downloadUrl: asset.browser_download_url,
    sha256,
    size: asset.size,
  };
}

function tarBinary(): string {
  // Windows ships bsdtar (which handles .zip too) at System32\tar.exe since
  // Windows 10 1803+. Resolve the full path so a git-bash/MSYS `tar` earlier
  // on PATH can't shadow it with an incompatible GNU tar.
  if (process.platform === "win32") {
    return path.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "tar.exe");
  }
  return "tar";
}

function extractArchive(archivePath: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  const result = spawnSync(tarBinary(), ["-xf", archivePath, "-C", destDir]);
  if (result.error || result.status !== 0) {
    throw new PrebuiltError(
      `Failed to extract ${archivePath}: ${result.error?.message ?? result.stderr?.toString().trim() ?? `exit code ${result.status}`}`,
    );
  }
}

function findBinary(root: string, name: string): string | undefined {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && entry.name === name) return full;
    if (entry.isDirectory()) {
      const found = findBinary(full, name);
      if (found) return found;
    }
  }
  return undefined;
}

export interface InstallPrebuiltOptions {
  force?: boolean;
  onProgress?: (progress: DownloadProgress) => void;
  /** Overrides the GitHub API base URL; for tests only. */
  apiBase?: string;
}

/**
 * Downloads and extracts the prebuilt llama-server for this platform,
 * verifying the archive's sha256 against GitHub's own asset digest before
 * extracting it (same verify-then-use discipline as model downloads).
 * Idempotent like buildRuntime(): a second call with an existing, still
 * valid lock is a no-op unless `force` is set.
 */
export async function installPrebuilt(dir: string, opts: InstallPrebuiltOptions = {}): Promise<PrebuiltLock> {
  const extractDir = path.join(dir, "prebuilt");

  if (!opts.force) {
    const existing = readLock(dir);
    if (existing?.source === "prebuilt" && fs.existsSync(existing.binaryPath)) {
      return existing;
    }
  }

  const asset = await resolvePrebuiltAsset({ ...(opts.apiBase ? { apiBase: opts.apiBase } : {}) });
  const archivePath = path.join(dir, asset.assetName);
  await downloadFile(asset.downloadUrl, archivePath, {
    expectedSize: asset.size,
    ...(asset.sha256 ? { expectedSha256: asset.sha256 } : {}),
    ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
  });

  fs.rmSync(extractDir, { recursive: true, force: true });
  extractArchive(archivePath, extractDir);
  fs.rmSync(archivePath, { force: true });

  const binaryName = process.platform === "win32" ? "llama-server.exe" : "llama-server";
  const binaryPath = findBinary(extractDir, binaryName);
  if (!binaryPath) {
    throw new PrebuiltError(`Extracted ${asset.assetName} but could not find ${binaryName} inside it.`);
  }
  if (process.platform !== "win32") {
    fs.chmodSync(binaryPath, 0o755);
  }

  const lock: PrebuiltLock = {
    source: "prebuilt",
    repo: asset.repo,
    tag: asset.tag,
    assetName: asset.assetName,
    builtAt: new Date().toISOString(),
    binaryPath,
  };
  writeLock(dir, lock);
  return lock;
}
