export class UnsupportedPlatformError extends Error {}

/**
 * Building and running the llama.cpp fork is only supported on Linux and
 * macOS for now. Fail fast with a clear message instead of letting a cmake
 * or spawn error surface later.
 */
export function assertSupportedPlatform(): void {
  if (process.platform !== "linux" && process.platform !== "darwin") {
    throw new UnsupportedPlatformError(
      `${TOOL_LABEL} does not support ${process.platform} yet: building and running the llama.cpp ` +
        "runtime is only implemented for Linux and macOS. Follow progress or contribute Windows " +
        "support at the project repository.",
    );
  }
}

const TOOL_LABEL = "reflex";

export type GpuBackend = "cuda" | "metal" | "cpu";

export interface GpuDetection {
  backend: GpuBackend;
  cmakeFlags: string[];
}

/**
 * Picks the cmake backend flags: CUDA if `nvcc` is on PATH, Metal by default
 * on macOS (no extra flags needed, it's llama.cpp's default there), CPU
 * otherwise.
 */
export function detectGpuBackend(hasNvcc: boolean): GpuDetection {
  if (hasNvcc) {
    return { backend: "cuda", cmakeFlags: ["-DGGML_CUDA=ON"] };
  }
  if (process.platform === "darwin") {
    return { backend: "metal", cmakeFlags: [] };
  }
  return { backend: "cpu", cmakeFlags: [] };
}
