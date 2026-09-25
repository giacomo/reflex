import type { DecisionSchema } from "./schema.js";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

const SYSTEM_PROMPT =
  "You are a decision function. Given a state and a fixed set of questions, each with a " +
  "closed list of allowed answers, choose exactly one answer per question. Respond with a " +
  "single JSON object whose keys are the question names and whose values are one of that " +
  "question's allowed answers, verbatim. Do not add extra keys, commentary, or formatting.";

function describeQuestions(schema: DecisionSchema): string {
  return schema.questions
    .map((q) => {
      const desc = q.description ? ` — ${q.description}` : "";
      return `- ${q.name}${desc} (allowed: ${q.options.join(" | ")})`;
    })
    .join("\n");
}

function stateToText(state: string | Record<string, unknown>): string {
  return typeof state === "string" ? state : JSON.stringify(state, null, 2);
}

export function buildMessages(
  state: string | Record<string, unknown>,
  schema: DecisionSchema,
): ChatMessage[] {
  const user = `State:\n${stateToText(state)}\n\nQuestions:\n${describeQuestions(schema)}`;
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}
