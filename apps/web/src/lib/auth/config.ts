import { z } from "zod";

const authConfigSchema = z.object({
  ADMIN_USERNAME: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(12, "ADMIN_PASSWORD must be at least 12 characters"),
  API_TOKEN: z.string().min(32, "API_TOKEN must be at least 32 characters"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
});

export type AuthConfig = z.infer<typeof authConfigSchema>;

export function loadAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig {
  const result = authConfigSchema.safeParse(env);

  if (!result.success) {
    throw new Error(`Invalid auth configuration:\n${z.prettifyError(result.error)}`);
  }

  return result.data;
}

let cached: AuthConfig | undefined;

/** Parsed once per process; `instrumentation.ts` calls it at start-up so bad values fail fast */
export function getAuthConfig(): AuthConfig {
  cached ??= loadAuthConfig();
  return cached;
}
