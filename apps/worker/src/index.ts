import { createServer } from "node:http";
import { loadConfig } from "@echdyn/core";

const config = loadConfig();
const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 3001);

const server = createServer((req, res) => {
  if (req.url !== "/health") {
    res.writeHead(404).end();
    return;
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ status: "ok" }));
});

server.listen(healthPort, () => {
  console.log(`worker ready (health on :${healthPort}, ollama at ${config.OLLAMA_HOST})`);
});

function shutdown(signal: NodeJS.Signals): void {
  console.log(`worker received ${signal}, shutting down`);
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
