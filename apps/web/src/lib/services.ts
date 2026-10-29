import {
  createDatabase,
  createDocumentQueue,
  createRedisConnection,
  createStorage,
  loadConfig,
  type IngestDependencies,
} from "@echdyn/core";

// One set of clients per server process. Cached on globalThis so dev hot reloads
// reuse the pool instead of opening new connections on every edit.
const cache = globalThis as typeof globalThis & { echdynServices?: IngestDependencies };

export function getServices(): IngestDependencies {
  if (!cache.echdynServices) {
    const config = loadConfig();
    cache.echdynServices = {
      db: createDatabase(config.DATABASE_URL).db,
      storage: createStorage(config),
      queue: createDocumentQueue(createRedisConnection(config.REDIS_URL)),
    };
  }

  return cache.echdynServices;
}
