export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  // Missing or weak credentials stop start-up rather than surfacing on the first request
  const { getAuthConfig } = await import("./lib/auth/config");
  getAuthConfig();

  const { createStorage, loadConfig } = await import("@echdyn/core");
  await createStorage(loadConfig()).ensureBucket();
}
