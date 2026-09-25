import type { DownloadProgress } from "../models/download.js";
import { formatBytes } from "./format.js";

export function renderProgress(label: string): (progress: DownloadProgress) => void {
  let lastPercent = -1;
  return ({ downloadedBytes, totalBytes }) => {
    if (!process.stdout.isTTY) return;
    if (!totalBytes) {
      process.stdout.write(`\r${label}: ${formatBytes(downloadedBytes)}`);
      return;
    }
    const percent = Math.floor((downloadedBytes / totalBytes) * 100);
    if (percent === lastPercent) return;
    lastPercent = percent;
    const barWidth = 24;
    const filled = Math.round((percent / 100) * barWidth);
    const bar = "#".repeat(filled) + "-".repeat(barWidth - filled);
    process.stdout.write(
      `\r${label}: [${bar}] ${percent}% (${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)})`,
    );
    if (percent >= 100) process.stdout.write("\n");
  };
}
