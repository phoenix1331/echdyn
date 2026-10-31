import {
  createDatabase,
  createOllamaClient,
  createPipelineStages,
  createRedisConnection,
  createStorage,
  createWebhookQueue,
  loadConfig,
  requeuePendingDeliveries,
} from "@echdyn/core";
import { createHealthServer } from "./health";
import { createWebhookWorker } from "./webhooks";
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

const webhookQueue = createWebhookQueue(connection);

const worker = createDocumentWorker({
  deps: { db: database.db, storage, webhooks: webhookQueue },
  stages: createPipelineStages({
    client: createOllamaClient(config.OLLAMA_HOST, config.OLLAMA_TIMEOUT_MS),
    textModel: config.OLLAMA_TEXT_MODEL,
    visionModel: config.OLLAMA_VISION_MODEL,
    autoApprove: config.AUTO_APPROVE,
  }),
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

const webhookWorker = createWebhookWorker({
  db: database.db,
  connection,
  log: (message) => {
    console.log(message);
  },
});
webhookWorker.on("error", (error) => {
  console.error("webhook worker error", error);
});

// Deliveries written by an approval whose process died before it could queue them. Never
// fatal: on a fresh database the worker can start before migrations have run
try {
  const requeued = await requeuePendingDeliveries(database.db, webhookQueue);
  if (requeued > 0) {
    console.log(`requeued ${String(requeued)} pending webhook deliveries`);
  }
} catch (error) {
  console.warn(
    "could not requeue pending webhook deliveries; they will be on the next start",
    error,
  );
}

const server = createHealthServer(() => worker.isRunning() && webhookWorker.isRunning());

server.listen(healthPort, () => {
  console.log(
    `worker ready (concurrency ${concurrency}, health on :${healthPort}, ollama ${config.OLLAMA_TEXT_MODEL} (text) and ${config.OLLAMA_VISION_MODEL} (vision) at ${config.OLLAMA_HOST})`,
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
  await Promise.all([worker.close(), webhookWorker.close()]);
  await webhookQueue.close();
  server.close();
  await connection.quit();
  await database.close();
  process.exit(0);
}

process.on("SIGTERM", (signal) => void shutdown(signal));
process.on("SIGINT", (signal) => void shutdown(signal));
