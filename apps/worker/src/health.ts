import { createServer, type Server } from "node:http";

export function createHealthServer(): Server {
  return createServer((req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  });
}
