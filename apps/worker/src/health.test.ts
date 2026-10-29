import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createHealthServer } from "./health";

describe("createHealthServer", () => {
  let server: Server;

  async function start(isHealthy?: () => boolean): Promise<string> {
    server = createHealthServer(isHealthy);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("returns ok on /health by default", async () => {
    const res = await fetch(`${await start()}/health`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("returns 503 when the worker is not running", async () => {
    const res = await fetch(`${await start(() => false)}/health`);

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "unavailable" });
  });

  it("returns 404 for any other path", async () => {
    const res = await fetch(`${await start()}/nope`);

    expect(res.status).toBe(404);
  });
});
