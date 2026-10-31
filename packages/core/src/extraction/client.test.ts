import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createOllamaClient, DEFAULT_OLLAMA_TIMEOUT_MS } from "./client";

describe("createOllamaClient", () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
  });

  /** A stand-in Ollama that takes `delayMs` before sending any headers, as a cold model does */
  async function slowOllama(delayMs: number): Promise<string> {
    server = createServer((_request, response) => {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ model: "m", message: { role: "assistant", content: "{}" }, done: true }),
        );
      }, delayMs);
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  }

  it("waits for a slow reply within its timeout", async () => {
    const client = createOllamaClient(await slowOllama(150), 2_000);

    const response = await client.chat({ model: "m", messages: [], stream: false });

    expect(response.message.content).toBe("{}");
  });

  it("gives up once the timeout passes without headers", async () => {
    const client = createOllamaClient(await slowOllama(1_000), 100);

    await expect(client.chat({ model: "m", messages: [], stream: false })).rejects.toThrow();
  });

  it("defaults to half an hour, far beyond fetch's usual 300 s", () => {
    expect(DEFAULT_OLLAMA_TIMEOUT_MS).toBe(1_800_000);
  });
});
