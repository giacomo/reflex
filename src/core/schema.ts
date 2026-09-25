import { z } from "zod";

const DecisionQuestionSchema = z.object({
  name: z.string().min(1),
  options: z.array(z.string().min(1)).min(1),
  description: z.string().optional(),
});
export type DecisionQuestion = z.infer<typeof DecisionQuestionSchema>;

export const DecisionSchemaSchema = z.object({
  questions: z.array(DecisionQuestionSchema).min(1),
});
export type DecisionSchema = z.infer<typeof DecisionSchemaSchema>;

export class SchemaError extends Error {}

export function parseDecisionSchema(raw: unknown): DecisionSchema {
  const result = DecisionSchemaSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new SchemaError(`Invalid decision schema:\n${issues}`);
  }
  const names = new Set<string>();
  for (const q of result.data.questions) {
    if (names.has(q.name)) {
      throw new SchemaError(`Invalid decision schema: duplicate question name "${q.name}"`);
    }
    names.add(q.name);
  }
  return result.data;
}

/** JSON Schema forcing an object with exactly these keys, each an enum of its allowed answers. */
export function toJsonSchema(schema: DecisionSchema): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const q of schema.questions) {
    properties[q.name] = {
      type: "string",
      enum: q.options,
      ...(q.description ? { description: q.description } : {}),
    };
  }
  return {
    type: "object",
    properties,
    required: schema.questions.map((q) => q.name),
    additionalProperties: false,
  };
}

/** A schema containing only the named question, for single-question escalation to the deep layer. */
export function narrowSchema(schema: DecisionSchema, questionName: string): DecisionSchema {
  const question = schema.questions.find((q) => q.name === questionName);
  if (!question) {
    throw new SchemaError(`Unknown question "${questionName}" in narrowSchema`);
  }
  return { questions: [question] };
}
