export class UnsupportedPlatformError extends Error {}

const TOOL_LABEL = "reflex";

/**
 * Linux and macOS build the XHToken/llama.cpp fork from source by default.
 * Windows always uses a downloaded prebuilt llama-server instead (see
 * prebuilt.ts) rather than trying to automate an MSVC/clang toolchain
 * setup; Linux/macOS also fall back to prebuilt if no compiler is found.
 */
export function isSupportedPlatform(): boolean {
  return process.platform === "linux" || process.platform === "darwin" || process.platform === "win32";
}

export function usesPrebuiltByDefault(): boolean {
  return process.platform === "win32";
}

export function unsupportedPlatformMessage(): string {
  return (
    `${TOOL_LABEL} does not support ${process.platform} yet: the llama.cpp runtime is only available ` +
    "as a source build (Linux/macOS) or a downloaded prebuilt binary (Linux/macOS/Windows). Follow " +
    "progress or contribute support for this platform at the project repository."
  );
}

/**
 * Fail fast with a clear message instead of letting a cmake or spawn error
 * surface later, for the (now rare) truly unsupported platforms.
 */
export function assertSupportedPlatform(): void {
  if (!isSupportedPlatform()) {
    throw new UnsupportedPlatformError(unsupportedPlatformMessage());
  }
}

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
