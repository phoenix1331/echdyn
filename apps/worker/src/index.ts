import { loadConfig } from "@echdyn/core";
import { createHealthServer } from "./health";

const config = loadConfig();
const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 3001);
const server = createHealthServer();

server.listen(healthPort, () => {
  console.log(`worker ready (health on :${healthPort}, ollama at ${config.OLLAMA_HOST})`);
});

function shutdown(signal: NodeJS.Signals): void {
  console.log(`worker received ${signal}, shutting down`);
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
