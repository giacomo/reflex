/**
 * Minimal Hugging Face HTTP API client: repo file listing (for quant
 * resolution + SHA-256) and file download URLs. Only top-level files are
 * listed (no recursive tree walk) since every model this tool supports keeps
 * its GGUF files at the repo root.
 */
export interface HfFile {
  path: string;
  size: number;
  /** SHA-256 hex digest, from the LFS pointer. Absent for small non-LFS files. */
  sha256: string | undefined;
}

export interface HfClientOptions {
  endpoint?: string | undefined;
  token?: string | undefined;
}

export class HfError extends Error {}

function endpointOf(opts?: HfClientOptions): string {
  return opts?.endpoint ?? process.env["HF_ENDPOINT"] ?? "https://huggingface.co";
}

function tokenOf(opts?: HfClientOptions): string | undefined {
  return opts?.token ?? process.env["HF_TOKEN"];
}

function authHeaders(opts?: HfClientOptions): Record<string, string> {
  const token = tokenOf(opts);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface HfTreeEntry {
  type: "file" | "directory";
  path: string;
  size: number;
  oid?: string;
  lfs?: { oid: string; size: number };
}

export async function listRepoFiles(repo: string, opts?: HfClientOptions): Promise<HfFile[]> {
  const url = `${endpointOf(opts)}/api/models/${repo}/tree/main`;
  const res = await fetch(url, { headers: authHeaders(opts) });
  if (!res.ok) {
    if (res.status === 404) {
      throw new HfError(`Repo not found on Hugging Face: ${repo}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new HfError(
        `Not authorized to read ${repo}. If this is a gated or private repo, set HF_TOKEN.`,
      );
    }
    throw new HfError(`Failed to list files for ${repo}: HTTP ${res.status}`);
  }
  const entries = (await res.json()) as HfTreeEntry[];
  return entries
    .filter((e) => e.type === "file")
    .map((e) => ({
      path: e.path,
      size: e.lfs?.size ?? e.size,
      sha256: e.lfs?.oid,
    }));
}

export function resolveDownloadUrl(repo: string, file: string, opts?: HfClientOptions): string {
  return `${endpointOf(opts)}/${repo}/resolve/main/${file}`;
}

export function downloadHeaders(opts?: HfClientOptions): Record<string, string> {
  return authHeaders(opts);
}
