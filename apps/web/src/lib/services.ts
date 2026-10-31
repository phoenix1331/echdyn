import {
  createDatabase,
  createDocumentQueue,
  createRedisConnection,
  createStorage,
  createWebhookQueue,
  loadConfig,
  type Config,
  type IngestDependencies,
  type WebhookQueue,
} from "@echdyn/core";

export type Services = IngestDependencies & { config: Config; webhooks: WebhookQueue };

// One set of clients per server process. Cached on globalThis so dev hot reloads
// reuse the pool instead of opening new connections on every edit.
const cache = globalThis as typeof globalThis & { echdynServices?: Services };

export function getServices(): Services {
  if (!cache.echdynServices) {
    const config = loadConfig();
    const connection = createRedisConnection(config.REDIS_URL);
    cache.echdynServices = {
      config,
      db: createDatabase(config.DATABASE_URL).db,
      storage: createStorage(config),
      queue: createDocumentQueue(connection),
      webhooks: createWebhookQueue(connection),
    };
  }

  return cache.echdynServices;
}
