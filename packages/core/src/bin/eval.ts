import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../config";
import { createDatabase, ensureDatabase } from "../db";
import { loadLabelledSet, renderReport, runEval } from "../eval";
import { createOllamaClient, PROMPT_VERSION, VISION_PROMPT_VERSION } from "../extraction";
import { createStorage } from "../storage";

const evalDir = resolve(import.meta.dirname, "../../../../eval");
const defaultSets = ["sets/synthetic", "sets/scanned", "sets/private"]
  .map((set) => resolve(evalDir, set))
  .filter((dir) => existsSync(dir));

const { values } = parseArgs({
  options: {
    models: { type: "string" },
    "vision-model": { type: "string" },
    set: { type: "string", multiple: true },
    // "5" caps every set; "scanned=5" caps only that set (repeatable)
    limit: { type: "string", multiple: true },
    out: { type: "string", default: resolve(evalDir, "results.md") },
  },
});

const config = loadConfig();
const models = (values.models ?? config.OLLAMA_TEXT_MODEL).split(",").map((m) => m.trim());
const visionModel = values["vision-model"] ?? config.OLLAMA_VISION_MODEL;
const setDirs = (values.set ?? defaultSets).map((dir) => resolve(dir));

// Never the app database: runEval resets the database before each model
const evalUrl = new URL(config.DATABASE_URL);
evalUrl.pathname = `${evalUrl.pathname}_eval`;
await ensureDatabase(evalUrl.toString());

// Limits apply per set, so a quick run still covers both text and scans
const limits = (values.limit ?? []).map((value) => value.split("=") as [string, string?]);
const limitFor = (set: string): number => {
  const named = limits.find(([name, count]) => count !== undefined && name === set);
  const global = limits.find(([, count]) => count === undefined);
  const value = named?.[1] ?? global?.[0];
  return value === undefined ? Infinity : Number(value);
};
const sets = await Promise.all(
  setDirs.map(async (dir) => ({
    name: basename(dir),
    documents: (await loadLabelledSet(dir)).slice(0, limitFor(basename(dir))),
  })),
);
const documents = sets.flatMap((s) => s.documents);
const hasScans = sets.some((s) => s.name === "scanned");

const storage = createStorage({ ...config, S3_BUCKET: `${config.S3_BUCKET}-eval` });
await storage.ensureBucket();
const { db, close } = createDatabase(evalUrl.toString(), { max: 2 });

console.log(
  `evaluating ${String(documents.length)} documents with ${models.join(", ")}, scans read by ${visionModel}`,
);

try {
  const { summaries, results } = await runEval({
    documents,
    models,
    visionModel,
    deps: { db, storage },
    client: createOllamaClient(config.OLLAMA_HOST, config.OLLAMA_TIMEOUT_MS),
    onProgress: (message) => {
      console.log(message);
    },
  });

  const report = renderReport(summaries, {
    date: new Date().toISOString().slice(0, 10),
    promptVersion: PROMPT_VERSION,
    ...(hasScans ? { vision: { model: visionModel, promptVersion: VISION_PROMPT_VERSION } } : {}),
    sets: sets.map((s) => ({ name: s.name, documents: s.documents.length })),
  });

  const out = resolve(values.out);
  await writeFile(out, report);
  await writeFile(out.replace(/\.md$/, ".json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`\n${report}\nwrote ${out}`);
} finally {
  await close();
}
