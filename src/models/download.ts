import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";

export class DownloadError extends Error {}

export interface DownloadProgress {
  downloadedBytes: number;
  totalBytes: number | undefined;
}

export interface DownloadOptions {
  headers?: Record<string, string>;
  onProgress?: (progress: DownloadProgress) => void;
  /** SHA-256 hex digest to verify against. If omitted, verification is skipped. */
  expectedSha256?: string;
  expectedSize?: number;
}

/**
 * Downloads `url` to `destPath`, resuming from a `${destPath}.part` file via
 * HTTP Range requests if one already exists. The file is only moved to
 * `destPath` after a full SHA-256 check succeeds; on mismatch the partial
 * file is deleted so the next run starts clean rather than resuming corrupt
 * bytes.
 */
export async function downloadFile(
  url: string,
  destPath: string,
  opts: DownloadOptions = {},
): Promise<void> {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const partPath = `${destPath}.part`;

  let existingBytes = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
  const headers: Record<string, string> = { ...opts.headers };
  if (existingBytes > 0) {
    headers["Range"] = `bytes=${existingBytes}-`;
  }

  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    throw new DownloadError(
      `Network error while downloading ${url}: ${(err as Error).message}. Check your connection and retry; the partial download will be resumed.`,
    );
  }

  let appendMode = false;
  if (res.status === 206) {
    appendMode = true;
  } else if (res.status === 200) {
    if (existingBytes > 0) {
      // Server ignored our Range request; the partial file can't be resumed.
      fs.rmSync(partPath, { force: true });
      existingBytes = 0;
    }
    appendMode = false;
  } else if (res.status === 416) {
    // Requested range not satisfiable: our partial file is already complete or corrupt.
    fs.rmSync(partPath, { force: true });
    existingBytes = 0;
    appendMode = false;
    res = await fetch(url, { headers: opts.headers ?? {} });
  } else {
    throw new DownloadError(`Failed to download ${url}: HTTP ${res.status}`);
  }

  if (!res.ok && res.status !== 206) {
    throw new DownloadError(`Failed to download ${url}: HTTP ${res.status}`);
  }
  if (!res.body) {
    throw new DownloadError(`Failed to download ${url}: empty response body`);
  }

  const totalBytes = opts.expectedSize ?? inferTotalBytes(res, existingBytes);
  let downloadedBytes = existingBytes;

  const writeStream = fs.createWriteStream(partPath, { flags: appendMode ? "a" : "w" });
  const nodeStream = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  nodeStream.on("data", (chunk: Buffer) => {
    downloadedBytes += chunk.length;
    opts.onProgress?.({ downloadedBytes, totalBytes });
  });

  try {
    await finished(nodeStream.pipe(writeStream));
  } catch (err) {
    throw new DownloadError(
      `Network error while downloading ${url}: ${(err as Error).message}. Rerun to resume from ${downloadedBytes} of ${totalBytes ?? "?"} bytes.`,
    );
  }

  if (opts.expectedSize !== undefined) {
    const actualSize = fs.statSync(partPath).size;
    if (actualSize !== opts.expectedSize) {
      fs.rmSync(partPath, { force: true });
      throw new DownloadError(
        `Downloaded file size (${actualSize}) does not match expected size (${opts.expectedSize}) for ${url}. Deleted the partial file; please retry.`,
      );
    }
  }

  if (opts.expectedSha256) {
    const actualSha256 = await sha256File(partPath);
    if (actualSha256 !== opts.expectedSha256) {
      fs.rmSync(partPath, { force: true });
      throw new DownloadError(
        `Checksum mismatch for ${url}: expected ${opts.expectedSha256}, got ${actualSha256}. Deleted the partial file; please retry.`,
      );
    }
  }

  fs.renameSync(partPath, destPath);
}

function inferTotalBytes(res: Response, alreadyDownloaded: number): number | undefined {
  const contentRange = res.headers.get("content-range");
  if (contentRange) {
    const match = /\/(\d+)$/.exec(contentRange);
    if (match?.[1]) return Number(match[1]);
  }
  const contentLength = res.headers.get("content-length");
  if (contentLength) {
    return alreadyDownloaded + Number(contentLength);
  }
  return undefined;
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}
