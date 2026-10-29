import {
  createDatabase,
  createExtractStage,
  createRedisConnection,
  createStorage,
  loadConfig,
  preProcessStage,
  validateStage,
} from "@echdyn/core";
import { Ollama } from "ollama";
import { createHealthServer } from "./health";
import { createDocumentWorker } from "./worker";

const config = loadConfig();
const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 3001);
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 1);

const database = createDatabase(config.DATABASE_URL);
const storage = createStorage(config);
const connection = createRedisConnection(config.REDIS_URL);

if (await storage.ensureBucket()) {
  console.log(`created storage bucket ${storage.bucket}`);
}

const worker = createDocumentWorker({
  deps: { db: database.db, storage },
  stages: [
    preProcessStage,
    createExtractStage({
      client: new Ollama({ host: config.OLLAMA_HOST }),
      model: config.OLLAMA_TEXT_MODEL,
    }),
    validateStage,
  ],
  connection,
  concurrency,
  log: (message) => {
    console.log(message);
  },
});

worker.on("completed", (job, outcome) => {
  console.log(`${job.data.documentId} -> ${outcome}`);
});
worker.on("error", (error) => {
  console.error("worker error", error);
});

const server = createHealthServer(() => worker.isRunning());

server.listen(healthPort, () => {
  console.log(
    `worker ready (concurrency ${concurrency}, health on :${healthPort}, ollama ${config.OLLAMA_TEXT_MODEL} at ${config.OLLAMA_HOST})`,
  );
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`worker received ${signal}, finishing active jobs`);

  // close() waits for in-flight jobs, so a deploy never abandons a document mid-extraction
  await worker.close();
  server.close();
  await connection.quit();
  await database.close();
  process.exit(0);
}

process.on("SIGTERM", (signal) => void shutdown(signal));
process.on("SIGINT", (signal) => void shutdown(signal));
