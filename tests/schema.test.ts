import { describe, expect, it } from "vitest";
import { parseDecisionSchema, toJsonSchema, narrowSchema, SchemaError } from "../src/core/schema.js";

const VALID = {
  questions: [
    { name: "mood", options: ["happy", "sad"], description: "overall mood" },
    { name: "urgent", options: ["yes", "no"] },
  ],
};

describe("parseDecisionSchema", () => {
  it("accepts a valid schema", () => {
    const schema = parseDecisionSchema(VALID);
    expect(schema.questions).toHaveLength(2);
  });

  it("rejects a question with no options", () => {
    expect(() => parseDecisionSchema({ questions: [{ name: "x", options: [] }] })).toThrow(
      SchemaError,
    );
  });

  it("rejects duplicate question names", () => {
    const dup = { questions: [VALID.questions[0], VALID.questions[0]] };
    expect(() => parseDecisionSchema(dup)).toThrow(/duplicate/);
  });

  it("rejects a schema with zero questions", () => {
    expect(() => parseDecisionSchema({ questions: [] })).toThrow(SchemaError);
  });
});

describe("toJsonSchema", () => {
  it("produces an object schema with enum properties and all keys required", () => {
    const schema = parseDecisionSchema(VALID);
    const json = toJsonSchema(schema) as {
      type: string;
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, { enum: string[] }>;
    };
    expect(json.type).toBe("object");
    expect(json.required).toEqual(["mood", "urgent"]);
    expect(json.additionalProperties).toBe(false);
    expect(json.properties["mood"]?.enum).toEqual(["happy", "sad"]);
  });
});

describe("narrowSchema", () => {
  it("returns a schema with only the named question", () => {
    const schema = parseDecisionSchema(VALID);
    const narrowed = narrowSchema(schema, "urgent");
    expect(narrowed.questions).toEqual([{ name: "urgent", options: ["yes", "no"] }]);
  });

  it("throws for an unknown question name", () => {
    const schema = parseDecisionSchema(VALID);
    expect(() => narrowSchema(schema, "nope")).toThrow(SchemaError);
  });
});
