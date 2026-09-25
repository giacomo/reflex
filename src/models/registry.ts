import { z } from "zod";
import registryData from "../../registry.json" with { type: "json" };

const RegistryModelSchema = z.object({
  displayName: z.string(),
  repo: z.string().regex(/^[^/]+\/[^/]+$/, "must be a Hugging Face repo id: <owner>/<name>"),
  license: z.string(),
  licenseUrl: z.string().url(),
  role: z.enum(["fast", "deep"]),
  /** Ordered, case-insensitive substrings matched against GGUF file names on the live HF tree. */
  quantPreference: z.array(z.string()).min(1),
  minMemoryBytesMultiplier: z.number().positive(),
  contextLength: z.number().int().positive(),
  supportsThinkingToggle: z.boolean(),
  /** "any" = works with a stock llama.cpp server too; "fork" = needs the XHToken fork's Spark2_5 support. */
  requiresRuntime: z.enum(["any", "fork"]),
  notes: z.string(),
});
export type RegistryModel = z.infer<typeof RegistryModelSchema>;

const RegistrySchema = z.object({
  version: z.number().int(),
  models: z.record(z.string(), RegistryModelSchema),
});
export type Registry = z.infer<typeof RegistrySchema>;

export class RegistryError extends Error {}

let cached: Registry | undefined;

export function loadRegistry(): Registry {
  if (!cached) {
    const result = RegistrySchema.safeParse(registryData);
    if (!result.success) {
      throw new RegistryError(`Built-in registry.json is invalid: ${result.error.message}`);
    }
    cached = result.data;
  }
  return cached;
}

export function getRegistryModel(name: string): RegistryModel {
  const registry = loadRegistry();
  const model = registry.models[name];
  if (!model) {
    const known = Object.keys(registry.models).join(", ");
    throw new RegistryError(`Unknown model "${name}". Known models: ${known}`);
  }
  return model;
}

export function listRegistryModels(): Array<{ name: string; model: RegistryModel }> {
  const registry = loadRegistry();
  return Object.entries(registry.models).map(([name, model]) => ({ name, model }));
}
