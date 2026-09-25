import os from "node:os";

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
