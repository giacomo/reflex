import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, ConfigError, DEFAULT_CONFIG } from "../src/config.js";

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reflex-config-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns defaults when no config file exists", () => {
    const config = loadConfig(undefined, tmpDir);
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(config.router.threshold).toBe(0.8);
    expect(config.fast.temperature).toBe(0.7);
    expect(config.deep.temperature).toBe(1.0);
    expect(config.deep.topK).toBe(-1);
  });

  it("merges a partial config over the defaults", () => {
    fs.writeFileSync(
      path.join(tmpDir, "reflex.config.json"),
      JSON.stringify({ router: { threshold: 0.5 } }),
    );
    const config = loadConfig(undefined, tmpDir);
    expect(config.router.threshold).toBe(0.5);
    expect(config.router.onMissingConfidence).toBe("escalate");
    expect(config.models.fast).toBe("minicpm5-1b");
  });

  it("throws a readable ConfigError on invalid JSON", () => {
    fs.writeFileSync(path.join(tmpDir, "reflex.config.json"), "{ not json");
    expect(() => loadConfig(undefined, tmpDir)).toThrow(ConfigError);
  });

  it("throws a readable ConfigError on schema violations", () => {
    fs.writeFileSync(
      path.join(tmpDir, "reflex.config.json"),
      JSON.stringify({ router: { threshold: 5 } }),
    );
    expect(() => loadConfig(undefined, tmpDir)).toThrow(/threshold/);
  });

  it("throws when an explicit path does not exist", () => {
    expect(() => loadConfig(path.join(tmpDir, "missing.json"))).toThrow(ConfigError);
  });
});
