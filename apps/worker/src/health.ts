import { createServer, type Server } from "node:http";

export function createHealthServer(isHealthy: () => boolean = () => true): Server {
  return createServer((req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }

    const healthy = isHealthy();
    res.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: healthy ? "ok" : "unavailable" }));
  });
}
