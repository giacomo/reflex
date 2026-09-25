import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { downloadFile, type DownloadProgress } from "../models/download.js";
import { readLock, writeLock, type PrebuiltLock } from "./lock.js";
import type { GpuBackend } from "./platform.js";

export class PrebuiltError extends Error {}

const REPO = "ggml-org/llama.cpp";
const GITHUB_API_BASE = `https://api.github.com/repos/${REPO}`;

/**
 * The Spark-X2.5-4B-GGUF model card states native `spark2_5` support
 * requires llama.cpp build b10828 or later. Mainline ggml-org/llama.cpp has
 * since merged that architecture (confirmed present in gguf-py/constants.py
 * as MODEL_ARCH.SPARK2_5, and in ggml-org/llama.cpp#27868), so its official
 * prebuilt releases work for both models reflex uses -- no need to build
 * the XHToken fork from source.
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

export interface ResolvedAssetFile {
  assetName: string;
  downloadUrl: string;
  sha256: string | undefined;
  size: number;
}

export interface PrebuiltAsset extends ResolvedAssetFile {
  repo: string;
  tag: string;
  backend: GpuBackend;
  /** CUDA builds ship the CUDA runtime DLLs in a separate archive, extracted alongside the main one. */
  companion: ResolvedAssetFile | undefined;
}

export function parseBuildNumber(tag: string): number | undefined {
  const match = /^b(\d+)$/.exec(tag);
  return match?.[1] ? Number(match[1]) : undefined;
}

function archTag(): "x64" | "arm64" {
  if (process.arch === "arm64") return "arm64";
  if (process.arch === "x64") return "x64";
  throw new PrebuiltError(
    `${REPO} does not publish a prebuilt llama-server for architecture "${process.arch}"; build from source instead.`,
  );
}

function platformTag(): "win" | "ubuntu" {
  if (process.platform === "win32") return "win";
  if (process.platform === "linux") return "ubuntu";
  throw new PrebuiltError(
    `${REPO} does not publish a CUDA prebuilt llama-server for platform "${process.platform}".`,
  );
}

export function computeAssetName(tag: string): string {
  const arch = archTag();
  if (process.platform === "win32") return `llama-${tag}-bin-win-cpu-${arch}.zip`;
  if (process.platform === "darwin") return `llama-${tag}-bin-macos-${arch}.tar.gz`;
  if (process.platform === "linux") return `llama-${tag}-bin-ubuntu-${arch}.tar.gz`;
  throw new PrebuiltError(
    `${REPO} does not publish a prebuilt llama-server for platform "${process.platform}"; build from source instead.`,
  );
}

function toResolvedFile(asset: GhAsset): ResolvedAssetFile {
  return {
    assetName: asset.name,
    downloadUrl: asset.browser_download_url,
    sha256: asset.digest?.startsWith("sha256:") ? asset.digest.slice("sha256:".length) : undefined,
    size: asset.size,
  };
}

function ext(assetName: string): string {
  return assetName.endsWith(".zip") ? "zip" : "tar.gz";
}

/**
 * Finds every CUDA build offered for this release/platform/arch by pattern
 * rather than a hardcoded CUDA version list (ggml-org has changed which
 * CUDA versions they ship before, e.g. 12.4 -> 13.4), then resolves each
 * one's cudart companion archive. GitHub's own asset naming is inconsistent
 * between platforms -- Linux's cudart asset includes the build tag, Windows's
 * doesn't -- so both conventions are tried.
 */
function findCudaOptions(
  release: GhRelease,
): Array<{ cudaVersion: number; main: GhAsset; cudart: GhAsset }> {
  const plat = platformTag();
  const arch = archTag();
  const mainPattern = new RegExp(
    `^llama-${escapeRegExp(release.tag_name)}-bin-${plat}-cuda-([\\d.]+)-${arch}\\.(?:zip|tar\\.gz)$`,
  );

  const found: Array<{ cudaVersion: number; version: string; main: GhAsset }> = [];
  for (const asset of release.assets) {
    const match = mainPattern.exec(asset.name);
    if (match?.[1]) {
      found.push({ cudaVersion: Number(match[1]), version: match[1], main: asset });
    }
  }
  found.sort((a, b) => b.cudaVersion - a.cudaVersion);

  const withCudart: Array<{ cudaVersion: number; main: GhAsset; cudart: GhAsset }> = [];
  for (const candidate of found) {
    const e = ext(candidate.main.name);
    const cudartNames = [
      `cudart-llama-${release.tag_name}-bin-${plat}-cuda-${candidate.version}-${arch}.${e}`, // Linux-style
      `cudart-llama-bin-${plat}-cuda-${candidate.version}-${arch}.${e}`, // Windows-style
    ];
    const cudart = release.assets.find((a) => cudartNames.includes(a.name));
    if (cudart) withCudart.push({ cudaVersion: candidate.cudaVersion, main: candidate.main, cudart });
  }
  return withCudart;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True if `nvidia-smi` runs successfully, meaning an NVIDIA driver is installed. */
export function hasNvidiaGpu(): boolean {
  try {
    return spawnSync("nvidia-smi", ["-L"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

export interface ResolvePrebuiltOptions {
  apiBase?: string;
  /** Defaults to a real `nvidia-smi` check; override for tests. */
  hasNvidiaGpu?: boolean;
}

/**
 * Finds the newest ggml-org/llama.cpp release build (tag `bNNNN`) at or
 * above MIN_BUILD_NUMBER and resolves the platform/arch-specific asset for
 * it. Always uses the latest compatible build rather than a pinned one --
 * these nightly-style builds are meant to always work. Prefers a CUDA build
 * (+ its cudart companion archive) when an NVIDIA GPU is detected and one is
 * available for this release; otherwise falls back to the plain CPU build
 * (macOS's plain build already includes Metal, so no separate variant exists).
 */
export async function resolvePrebuiltAsset(opts: ResolvePrebuiltOptions = {}): Promise<PrebuiltAsset> {
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
  const release = compatible.release;

  const wantsCuda =
    (opts.hasNvidiaGpu ?? hasNvidiaGpu()) && (process.platform === "win32" || process.platform === "linux");
  if (wantsCuda) {
    const cudaOptions = findCudaOptions(release);
    const best = cudaOptions[0];
    if (best) {
      return {
        repo: REPO,
        tag: release.tag_name,
        backend: "cuda",
        ...toResolvedFile(best.main),
        companion: toResolvedFile(best.cudart),
      };
    }
  }

  const backend: GpuBackend = process.platform === "darwin" ? "metal" : "cpu";
  const assetName = computeAssetName(release.tag_name);
  const asset = release.assets.find((a) => a.name === assetName);
  if (!asset) {
    throw new PrebuiltError(
      `Release ${release.tag_name} has no "${assetName}" asset for ${process.platform}/${process.arch}.`,
    );
  }
  return { repo: REPO, tag: release.tag_name, backend, ...toResolvedFile(asset), companion: undefined };
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

async function downloadAndExtract(
  file: ResolvedAssetFile,
  dir: string,
  extractDir: string,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
  const archivePath = path.join(dir, file.assetName);
  await downloadFile(file.downloadUrl, archivePath, {
    expectedSize: file.size,
    ...(file.sha256 ? { expectedSha256: file.sha256 } : {}),
    ...(onProgress ? { onProgress } : {}),
  });
  extractArchive(archivePath, extractDir);
  fs.rmSync(archivePath, { force: true });
}

export interface InstallPrebuiltOptions {
  force?: boolean;
  onProgress?: (progress: DownloadProgress) => void;
  /** Overrides the GitHub API base URL; for tests only. */
  apiBase?: string;
  /** Overrides GPU detection; for tests only. */
  hasNvidiaGpu?: boolean;
}

/**
 * Downloads and extracts the prebuilt llama-server for this platform (and,
 * for a CUDA build, its cudart companion archive into the same directory),
 * verifying each archive's sha256 against GitHub's own asset digest before
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

  const asset = await resolvePrebuiltAsset({
    ...(opts.apiBase ? { apiBase: opts.apiBase } : {}),
    ...(opts.hasNvidiaGpu !== undefined ? { hasNvidiaGpu: opts.hasNvidiaGpu } : {}),
  });

  fs.rmSync(extractDir, { recursive: true, force: true });
  await downloadAndExtract(asset, dir, extractDir, opts.onProgress);
  if (asset.companion) {
    await downloadAndExtract(asset.companion, dir, extractDir, opts.onProgress);
  }

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
    backend: asset.backend,
    assetName: asset.assetName,
    companionAssetName: asset.companion?.assetName,
    builtAt: new Date().toISOString(),
    binaryPath,
  };
  writeLock(dir, lock);
  return lock;
}
