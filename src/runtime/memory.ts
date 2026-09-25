import os from "node:os";
import { spawnSync } from "node:child_process";

export interface MemoryRequirement {
  role: "fast" | "deep";
  name: string;
  requiredBytes: number;
}

export interface MemoryCheck {
  requirements: MemoryRequirement[];
  totalRequiredBytes: number;
  availableBytes: number;
  sufficient: boolean;
}

/**
 * Rough heuristic, not a benchmarked figure: a loaded GGUF model needs more
 * RAM than its file size (KV cache, activations, allocator overhead), scaled
 * by `minMemoryBytesMultiplier` from the registry entry.
 */
export function checkMemory(
  requirements: MemoryRequirement[],
  availableBytes: number = os.freemem(),
): MemoryCheck {
  const totalRequiredBytes = requirements.reduce((sum, r) => sum + r.requiredBytes, 0);
  return {
    requirements,
    totalRequiredBytes,
    availableBytes,
    sufficient: totalRequiredBytes <= availableBytes,
  };
}

export interface ProcessMemoryReader {
  (pid: number): number | undefined;
}

/** Resident set size of a running process, via `ps` (available on both Linux and macOS). */
export const readProcessRssBytes: ProcessMemoryReader = (pid) => {
  try {
    const result = spawnSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" });
    if (result.status !== 0) return undefined;
    const kb = Number(result.stdout.trim());
    return Number.isFinite(kb) ? kb * 1024 : undefined;
  } catch {
    return undefined;
  }
};
