import { describe, expect, it } from "vitest";
import { getRegistryModel, listRegistryModels, RegistryError } from "../src/models/registry.js";

describe("registry", () => {
  it("lists the built-in fast and deep models", () => {
    const models = listRegistryModels();
    const names = models.map((m) => m.name).sort();
    expect(names).toEqual(["minicpm5-1b", "spark-x2.5-4b"]);
  });

  it("resolves minicpm5-1b as the fast role", () => {
    const model = getRegistryModel("minicpm5-1b");
    expect(model.role).toBe("fast");
    expect(model.repo).toBe("openbmb/MiniCPM5-1B-GGUF");
    expect(model.license.toLowerCase()).toContain("apache");
  });

  it("resolves spark-x2.5-4b as the deep role requiring the fork runtime", () => {
    const model = getRegistryModel("spark-x2.5-4b");
    expect(model.role).toBe("deep");
    expect(model.requiresRuntime).toBe("fork");
  });

  it("throws a readable error for an unknown model", () => {
    expect(() => getRegistryModel("does-not-exist")).toThrow(RegistryError);
  });
});
