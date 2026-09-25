import type { RouterConfig } from "../config.js";

/**
 * A confidence of `undefined` means the backend returned no usable logprobs
 * (see confidence.ts); `router.onMissingConfidence` decides whether that
 * counts as "needs a second opinion" or "trust the fast answer anyway".
 */
export function shouldEscalate(confidence: number | undefined, router: RouterConfig): boolean {
  if (confidence === undefined) {
    return router.onMissingConfidence === "escalate";
  }
  return confidence < router.threshold;
}
