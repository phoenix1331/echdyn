import { DeleteBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import { createStorage, documentStorageKey } from "./storage";

const testBucket = process.env.TEST_S3_BUCKET;

describe("documentStorageKey", () => {
  it("namespaces by type and shards by hash prefix", () => {
    const sha = `ab${"c".repeat(62)}`;

    expect(documentStorageKey("uk-energy-bill", sha)).toBe(`uk-energy-bill/ab/${sha}.pdf`);
  });
});

describe.skipIf(!testBucket)("createStorage", () => {
  const config = { ...loadConfig(), S3_BUCKET: testBucket ?? "" };
  const storage = createStorage(config);
  const key = `tests/${Date.now()}.pdf`;
  const body = new TextEncoder().encode("%PDF-1.7 test");

  it("creates a missing bucket, then reports it already exists", async () => {
    const bucket = `${testBucket ?? ""}-${Date.now()}`;
    const fresh = createStorage({ ...config, S3_BUCKET: bucket });

    try {
      await expect(fresh.ensureBucket()).resolves.toBe(true);
      await expect(fresh.ensureBucket()).resolves.toBe(false);
    } finally {
      const admin = new S3Client({
        endpoint: config.S3_ENDPOINT,
        region: config.S3_REGION,
        forcePathStyle: true,
        credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
      });
      await admin.send(new DeleteBucketCommand({ Bucket: bucket }));
    }
  });

  it("ensures the shared test bucket", async () => {
    await expect(storage.ensureBucket()).resolves.toBeTypeOf("boolean");
  });

  it("round-trips an object", async () => {
    await storage.put(key, body, "application/pdf");

    expect(await storage.get(key)).toEqual(body);
  });

  it("returns null for a missing object", async () => {
    expect(await storage.get("tests/missing.pdf")).toBeNull();
  });

  it("signs URLs against the public endpoint", async () => {
    const url = new URL(await storage.signedUrl(key, 60));
    const publicEndpoint = new URL(config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT);

    expect(url.host).toBe(publicEndpoint.host);
    expect(url.pathname).toBe(`/${config.S3_BUCKET}/${key}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
  });

  it("signed URLs download the object", async () => {
    const internal = createStorage({ ...config, S3_PUBLIC_ENDPOINT: config.S3_ENDPOINT });
    const res = await fetch(await internal.signedUrl(key));

    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(body);
  });

  it("removes an object", async () => {
    await storage.remove(key);

    expect(await storage.get(key)).toBeNull();
  });

  it("surfaces errors other than not found", async () => {
    const denied = createStorage({ ...config, S3_SECRET_KEY: "wrong-secret" });

    await expect(denied.ensureBucket()).rejects.toThrow();
    await expect(denied.get(key)).rejects.toThrow();
  });
});
