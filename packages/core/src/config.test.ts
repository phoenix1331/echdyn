import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

const validEnv = {
  DATABASE_URL: "postgres://echdyn:echdyn@postgres:5432/echdyn",
  REDIS_URL: "redis://redis:6379",
  S3_ENDPOINT: "http://storage:9000",
  S3_BUCKET: "echdyn-documents",
  S3_ACCESS_KEY: "echdyn",
  S3_SECRET_KEY: "echdyn-secret",
  OLLAMA_HOST: "http://ollama:11434",
  OLLAMA_TEXT_MODEL: "qwen3:8b",
  OLLAMA_VISION_MODEL: "qwen2.5vl:7b",
};

describe("loadConfig", () => {
  it("parses a valid environment and applies defaults", () => {
    const config = loadConfig(validEnv);

    expect(config.S3_REGION).toBe("us-east-1");
    expect(config.S3_FORCE_PATH_STYLE).toBe(true);
    expect(config.OLLAMA_TEXT_MODEL).toBe("qwen3:8b");
  });

  it("coerces S3_FORCE_PATH_STYLE from a string", () => {
    const config = loadConfig({ ...validEnv, S3_FORCE_PATH_STYLE: "false" });

    expect(config.S3_FORCE_PATH_STYLE).toBe(false);
  });

  it("throws a readable error listing invalid keys", () => {
    const env: Record<string, string> = { ...validEnv, OLLAMA_HOST: "not a url" };
    delete env.DATABASE_URL;

    expect(() => loadConfig(env)).toThrow(
      /Invalid environment configuration[\s\S]*DATABASE_URL[\s\S]*OLLAMA_HOST/,
    );
  });
});
