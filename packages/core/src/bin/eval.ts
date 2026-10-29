import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Ollama } from "ollama";
import { loadConfig } from "../config";
import { createDatabase, ensureDatabase } from "../db";
import { loadLabelledSet, renderReport, runEval } from "../eval";
import { PROMPT_VERSION } from "../extraction";
import { createStorage } from "../storage";

const evalDir = resolve(import.meta.dirname, "../../../../eval");
const defaultSets = ["sets/synthetic", "sets/private"]
  .map((set) => resolve(evalDir, set))
  .filter((dir) => existsSync(dir));

const { values } = parseArgs({
  options: {
    models: { type: "string" },
    set: { type: "string", multiple: true },
    limit: { type: "string" },
    out: { type: "string", default: resolve(evalDir, "results.md") },
  },
});

const config = loadConfig();
const models = (values.models ?? config.OLLAMA_TEXT_MODEL).split(",").map((m) => m.trim());
const setDirs = (values.set ?? defaultSets).map((dir) => resolve(dir));

// Never the app database: runEval resets the database before each model
const evalUrl = new URL(config.DATABASE_URL);
evalUrl.pathname = `${evalUrl.pathname}_eval`;
await ensureDatabase(evalUrl.toString());

const sets = await Promise.all(
  setDirs.map(async (dir) => ({ name: basename(dir), documents: await loadLabelledSet(dir) })),
);
const limit = values.limit === undefined ? Infinity : Number(values.limit);
const documents = sets.flatMap((s) => s.documents).slice(0, limit);

const storage = createStorage({ ...config, S3_BUCKET: `${config.S3_BUCKET}-eval` });
await storage.ensureBucket();
const { db, close } = createDatabase(evalUrl.toString(), { max: 2 });

console.log(`evaluating ${String(documents.length)} documents with ${models.join(", ")}`);

try {
  const { summaries, results } = await runEval({
    documents,
    models,
    deps: { db, storage },
    client: new Ollama({ host: config.OLLAMA_HOST }),
    onProgress: (message) => {
      console.log(message);
    },
  });

  const report = renderReport(summaries, {
    date: new Date().toISOString().slice(0, 10),
    promptVersion: PROMPT_VERSION,
    sets: sets.map((s) => ({
      name: s.name,
      documents: s.documents.filter((d) => documents.includes(d)).length,
    })),
  });

  const out = resolve(values.out);
  await writeFile(out, report);
  await writeFile(out.replace(/\.md$/, ".json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`\n${report}\nwrote ${out}`);
} finally {
  await close();
}
