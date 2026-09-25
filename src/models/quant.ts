import type { HfFile } from "./hf.js";

export class QuantSelectionError extends Error {}

function matchesQuant(fileName: string, quant: string): boolean {
  const base = fileName.replace(/\.gguf$/i, "");
  // Quant tags themselves contain underscores (e.g. "Q4_K_M"), so only "-",
  // "." or the string boundary count as separators from the rest of the name.
  // This deliberately does not try to disambiguate suffixed variants like
  // "Q4_K_M-XL" from plain "Q4_K_M"; neither repo in the registry uses those.
  const pattern = new RegExp(`(?:^|[-.])${escapeRegExp(quant)}(?:[-.]|$)`, "i");
  return pattern.test(base);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Picks the GGUF file matching the first available quant in `quantPreference`
 * order (case-insensitive, e.g. "Q4_K_M" matches "Spark-X2.5-4B-Q4_K_M.gguf"
 * but not "...-Q4_K_M_XL.gguf" or "...-IQ4_K_M.gguf"). Falls back to the
 * smallest .gguf file in the repo if none of the preferred quants are found.
 */
export function pickQuantFile(files: HfFile[], quantPreference: readonly string[]): HfFile {
  const ggufFiles = files.filter((f) => f.path.toLowerCase().endsWith(".gguf"));
  if (ggufFiles.length === 0) {
    throw new QuantSelectionError("No .gguf files found in this repo.");
  }
  for (const quant of quantPreference) {
    const match = ggufFiles.find((f) => matchesQuant(f.path, quant));
    if (match) return match;
  }
  const smallest = [...ggufFiles].sort((a, b) => a.size - b.size)[0];
  if (!smallest) {
    throw new QuantSelectionError("No .gguf files found in this repo.");
  }
  return smallest;
}

