import fs from "node:fs";
import path from "node:path";
import { modelsDir } from "../paths.js";
import { getRegistryModel, type RegistryModel } from "./registry.js";
import { listRepoFiles, resolveDownloadUrl, downloadHeaders, type HfClientOptions } from "./hf.js";
import { pickQuantFile, QuantSelectionError } from "./quant.js";
import { downloadFile, type DownloadProgress } from "./download.js";

export class ModelManagerError extends Error {}

export interface ModelSource {
  repo: string;
  license: string;
  licenseUrl: string;
  quantPreference: readonly string[];
  role: "fast" | "deep";
  requiresRuntime: "any" | "fork";
  minMemoryBytesMultiplier: number;
}

export interface ModelManifest {
  name: string;
  repo: string;
  file: string;
  sizeBytes: number;
  sha256: string | undefined;
  license: string;
  licenseUrl: string;
  role: "fast" | "deep";
  requiresRuntime: "any" | "fork";
  minMemoryBytesMultiplier: number;
  pulledAt: string;
}

export interface PullConfirmation {
  name: string;
  repo: string;
  file: string;
  sizeBytes: number;
  license: string;
  licenseUrl: string;
}

export interface PullOptions {
  /** Bypasses the registry and pulls an arbitrary Hugging Face repo instead. */
  unsafeRepo?: string;
  /** Skips the confirmation prompt (equivalent to CLI --yes). */
  yes?: boolean;
  confirm?: (info: PullConfirmation) => boolean | Promise<boolean>;
  onProgress?: (progress: DownloadProgress) => void;
  hf?: HfClientOptions;
}

export type PullResult =
  | { status: "already-present"; manifest: ModelManifest }
  | { status: "downloaded"; manifest: ModelManifest }
  | { status: "cancelled" };

const UNSAFE_QUANT_PREFERENCE = ["Q4_K_M", "Q4_K_S", "Q4_0", "Q8_0", "F16"];

function resolveSource(name: string, unsafeRepo?: string): ModelSource {
  if (unsafeRepo) {
    return {
      repo: unsafeRepo,
      license: "unknown (--unsafe-repo bypasses the registry; verify the license yourself)",
      licenseUrl: `https://huggingface.co/${unsafeRepo}`,
      quantPreference: UNSAFE_QUANT_PREFERENCE,
      role: "fast",
      requiresRuntime: "any",
      minMemoryBytesMultiplier: 1.5,
    };
  }
  const model: RegistryModel = getRegistryModel(name);
  return {
    repo: model.repo,
    license: model.license,
    licenseUrl: model.licenseUrl,
    quantPreference: model.quantPreference,
    minMemoryBytesMultiplier: model.minMemoryBytesMultiplier,
    role: model.role,
    requiresRuntime: model.requiresRuntime,
  };
}

function modelDir(name: string): string {
  return path.join(modelsDir(), name);
}

function manifestPath(name: string): string {
  return path.join(modelDir(name), "manifest.json");
}

export function readManifest(name: string): ModelManifest | undefined {
  const file = manifestPath(name);
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8")) as ModelManifest;
}

/** Absolute path to the local GGUF file for a pulled model, or undefined if not pulled. */
export function getLocalModelPath(name: string): string | undefined {
  const manifest = readManifest(name);
  if (!manifest) return undefined;
  const file = path.join(modelDir(name), manifest.file);
  return fs.existsSync(file) ? file : undefined;
}

export async function pullModel(name: string, opts: PullOptions = {}): Promise<PullResult> {
  const source = resolveSource(name, opts.unsafeRepo);

  const existing = readManifest(name);
  if (existing && getLocalModelPath(name)) {
    return { status: "already-present", manifest: existing };
  }

  let files;
  try {
    files = await listRepoFiles(source.repo, opts.hf);
  } catch (err) {
    throw new ModelManagerError((err as Error).message);
  }

  let picked;
  try {
    picked = pickQuantFile(files, source.quantPreference);
  } catch (err) {
    if (err instanceof QuantSelectionError) {
      throw new ModelManagerError(`${source.repo}: ${err.message}`);
    }
    throw err;
  }

  if (!opts.yes) {
    const confirmed = opts.confirm
      ? await opts.confirm({
          name,
          repo: source.repo,
          file: picked.path,
          sizeBytes: picked.size,
          license: source.license,
          licenseUrl: source.licenseUrl,
        })
      : false;
    if (!confirmed) {
      return { status: "cancelled" };
    }
  }

  const destDir = modelDir(name);
  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, picked.path);
  const url = resolveDownloadUrl(source.repo, picked.path, opts.hf);

  await downloadFile(url, destPath, {
    headers: downloadHeaders(opts.hf),
    expectedSize: picked.size,
    ...(picked.sha256 ? { expectedSha256: picked.sha256 } : {}),
    ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
  });

  const manifest: ModelManifest = {
    name,
    repo: source.repo,
    file: picked.path,
    sizeBytes: picked.size,
    sha256: picked.sha256,
    license: source.license,
    licenseUrl: source.licenseUrl,
    role: source.role,
    requiresRuntime: source.requiresRuntime,
    minMemoryBytesMultiplier: source.minMemoryBytesMultiplier,
    pulledAt: new Date().toISOString(),
  };
  fs.writeFileSync(manifestPath(name), JSON.stringify(manifest, null, 2));

  return { status: "downloaded", manifest };
}

export function listLocalModels(): ModelManifest[] {
  const dir = modelsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readManifest(entry.name))
    .filter((m): m is ModelManifest => m !== undefined);
}

export function removeModel(name: string): boolean {
  const dir = modelDir(name);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}
