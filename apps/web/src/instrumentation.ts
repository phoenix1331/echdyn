export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { createStorage, loadConfig } = await import("@echdyn/core");
  await createStorage(loadConfig()).ensureBucket();
}
