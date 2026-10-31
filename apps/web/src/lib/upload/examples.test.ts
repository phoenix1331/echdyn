import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { examplesDir, loadExamples, readExample } from "./examples";

describe("examples", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "echdyn-examples-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const listed = { file: "gas-bill.pdf", title: "Gas", description: "A gas bill" };

  it("lists the manifest and serves only the files in it", async () => {
    await writeFile(join(dir, "examples.json"), JSON.stringify([listed]));
    await writeFile(join(dir, "gas-bill.pdf"), "%PDF-1.7 gas");
    await writeFile(join(dir, "secret.pdf"), "%PDF-1.7 secret");

    expect(await loadExamples(dir)).toEqual([listed]);
    expect(new TextDecoder().decode((await readExample("gas-bill.pdf", dir)) ?? undefined)).toBe(
      "%PDF-1.7 gas",
    );
    expect(await readExample("secret.pdf", dir)).toBeNull();
    expect(await readExample("../examples.json", dir)).toBeNull();
  });

  it("returns nothing for a missing folder, a bad manifest, or a listed file that is missing", async () => {
    expect(await loadExamples(join(dir, "missing"))).toEqual([]);

    await writeFile(join(dir, "examples.json"), JSON.stringify([{ ...listed, file: "../x.pdf" }]));
    expect(await loadExamples(dir)).toEqual([]);

    await writeFile(join(dir, "examples.json"), JSON.stringify([listed]));
    expect(await readExample("gas-bill.pdf", dir)).toBeNull();
  });

  it("finds the repository's examples folder from the web app, and the shipped manifest loads", async () => {
    const saved = process.env.EXAMPLES_DIR;
    process.env.EXAMPLES_DIR = "/somewhere";
    expect(examplesDir()).toBe("/somewhere");
    delete process.env.EXAMPLES_DIR;

    const repo = resolve(import.meta.dirname, "../../../../../examples");
    const shipped = await loadExamples(repo);
    expect(shipped.length).toBeGreaterThanOrEqual(5);
    for (const example of shipped) {
      expect(await readExample(example.file, repo), example.file).not.toBeNull();
    }

    if (saved !== undefined) {
      process.env.EXAMPLES_DIR = saved;
    }
  });
});
