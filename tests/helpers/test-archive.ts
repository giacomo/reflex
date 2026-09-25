import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

function tarBinary(): string {
  if (process.platform === "win32") {
    return path.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "tar.exe");
  }
  return "tar";
}

/**
 * Creates a real archive (a .zip on Windows via bsdtar, a .tar.gz elsewhere)
 * at `destPath` containing `files` (relative path -> content), so tests
 * exercise the same `tar -xf` extraction path prebuilt.ts uses in
 * production instead of a hand-rolled fake.
 */
export function createTestArchive(destPath: string, files: Record<string, string>): void {
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), "reflex-archive-stage-"));
  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(stageDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  const topLevelEntries = [...new Set(Object.keys(files).map((f) => f.split("/")[0]!))];
  const args =
    process.platform === "win32"
      ? ["-a", "-cf", destPath, "-C", stageDir, ...topLevelEntries]
      : ["-czf", destPath, "-C", stageDir, ...topLevelEntries];
  const result = spawnSync(tarBinary(), args);
  fs.rmSync(stageDir, { recursive: true, force: true });
  if (result.status !== 0) {
    throw new Error(`failed to create test archive at ${destPath}: ${result.stderr?.toString() ?? result.error}`);
  }
}
