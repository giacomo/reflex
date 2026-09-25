import { z } from "zod";
import fs from "node:fs";
import { DecisionSchemaSchema, type DecisionSchema } from "../core/schema.js";

export class BenchTaskError extends Error {}

const TaskSchema = z.object({
  schema: DecisionSchemaSchema,
  state: z.union([z.string(), z.record(z.string(), z.unknown())]),
  expected: z.record(z.string(), z.string()),
});
export type BenchTask = z.infer<typeof TaskSchema> & { schema: DecisionSchema };

/** Parses a JSONL file: one task per non-empty line. */
export function loadTasks(filePath: string): BenchTask[] {
  const text = fs.readFileSync(filePath, "utf8");
  const tasks: BenchTask[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (err) {
      throw new BenchTaskError(`${filePath}:${i + 1}: invalid JSON (${(err as Error).message})`);
    }
    const result = TaskSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues.map((iss) => `${iss.path.join(".")}: ${iss.message}`).join("; ");
      throw new BenchTaskError(`${filePath}:${i + 1}: ${issues}`);
    }
    const missing = result.data.schema.questions
      .map((q) => q.name)
      .filter((name) => !(name in result.data.expected));
    if (missing.length > 0) {
      throw new BenchTaskError(
        `${filePath}:${i + 1}: missing expected answers for: ${missing.join(", ")}`,
      );
    }
    tasks.push(result.data);
  }
  if (tasks.length === 0) {
    throw new BenchTaskError(`${filePath} contains no tasks.`);
  }
  return tasks;
}
