import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_DEEP_PORT, DEFAULT_FAST_PORT, DEFAULT_SERVE_PORT } from "./constants.js";

/**
 * Generation parameters sent to llama-server. Defaults for `fast` follow
 * MiniCPM5's recommended sampling (temperature=1.0, top_p=0.95, min_p=0.0).
 * Defaults for `deep` follow the Spark-X2.5 model card (temperature=1.0,
 * top_p=0.95, top_k=-1). Both set min_p to 0 rather than llama-server's
 * own 0.05 default, which can suppress the exact tokens needed to break a
 * repetition loop; if repetitive output still shows up, MiniCPM's card
 * suggests adding `repetitionPenalty: 1.05`.
 */
const GenerationParamsSchema = z.object({
  temperature: z.number().min(0),
  topP: z.number().min(0).max(1),
  topK: z.number().int(),
  minP: z.number().min(0).max(1),
  repetitionPenalty: z.number().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
});
export type GenerationParams = z.infer<typeof GenerationParamsSchema>;

const GpuLayersSchema = z.union([z.number().int().min(0), z.literal("auto"), z.literal("all")]);

const RuntimeBinaryOverrideSchema = z.object({
  binary: z.string().optional(),
});

const RuntimeSchema = z.object({
  contextSize: z.object({
    fast: z.number().int().positive().default(4096),
    /** Kept small by default: Spark-X2.5's native 1M-token context needs a lot of memory. */
    deep: z.number().int().positive().default(8192),
  }).default({}),
  gpuLayers: GpuLayersSchema.default("auto"),
  threads: z.number().int().default(-1),
  fast: RuntimeBinaryOverrideSchema.default({}),
  deep: RuntimeBinaryOverrideSchema.default({}),
});
export type RuntimeConfig = z.infer<typeof RuntimeSchema>;

const RouterSchema = z.object({
  threshold: z.number().min(0).max(1).default(0.8),
  onMissingConfidence: z.enum(["escalate", "accept"]).default("escalate"),
  calibration: z.object({
    temperature: z.number().positive().default(1.0),
  }).default({}),
});
export type RouterConfig = z.infer<typeof RouterSchema>;

const ServerSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.number().int().positive().default(DEFAULT_SERVE_PORT),
});

const ModelsSchema = z.object({
  fast: z.string().default("minicpm5-1b"),
  deep: z.string().default("spark-x2.5-4b"),
});

export const ConfigSchema = z.object({
  models: ModelsSchema.default({}),
  runtime: RuntimeSchema.default({}),
  fast: GenerationParamsSchema.default({
    temperature: 1.0,
    topP: 0.95,
    topK: 40,
    minP: 0.0,
  }),
  deep: GenerationParamsSchema.default({
    temperature: 1.0,
    topP: 0.95,
    topK: -1,
    minP: 0.0,
  }),
  router: RouterSchema.default({}),
  server: ServerSchema.default({}),
  autostart: z.boolean().default(true),
  ports: z.object({
    fast: z.number().int().positive().default(DEFAULT_FAST_PORT),
    deep: z.number().int().positive().default(DEFAULT_DEEP_PORT),
  }).default({}),
});
export type ReflexConfig = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: ReflexConfig = ConfigSchema.parse({});

export class ConfigError extends Error {}

/**
 * Loads `reflex.config.json` from `cwd` (or an explicit path), validating it
 * against the schema. Returns defaults if no file is present. Throws
 * ConfigError with a human-readable message (no zod stack trace) on invalid
 * config, per the project's "no stack traces for expected failures" rule.
 */
export function loadConfig(explicitPath?: string, cwd = process.cwd()): ReflexConfig {
  const configPath = explicitPath ?? path.join(cwd, "reflex.config.json");
  if (!fs.existsSync(configPath)) {
    if (explicitPath) {
      throw new ConfigError(`Config file not found: ${configPath}`);
    }
    return DEFAULT_CONFIG;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (err) {
    throw new ConfigError(`Could not parse ${configPath} as JSON: ${(err as Error).message}`);
  }
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ConfigError(`Invalid config at ${configPath}:\n${issues}`);
  }
  return result.data;
}
