import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHealthServer } from "./health";

describe("createHealthServer", () => {
  const server = createHealthServer();
  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("returns ok on /health", async () => {
    const res = await fetch(`${baseUrl}/health`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("returns 404 for any other path", async () => {
    const res = await fetch(`${baseUrl}/nope`);

    expect(res.status).toBe(404);
  });
});
