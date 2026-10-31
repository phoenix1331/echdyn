import { z } from "zod";

const configSchema = z.object({
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  S3_ENDPOINT: z.url(),
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.stringbool().default(true),
  OLLAMA_HOST: z.url(),
  OLLAMA_TEXT_MODEL: z.string().min(1),
  OLLAMA_VISION_MODEL: z.string().min(1),
  AUTO_APPROVE: z.stringbool().default(true),
  /** Where reviewed documents are added as labelled examples; unset hides the option */
  LABELLED_SET_DIR: z.string().min(1).optional(),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);

  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }

  return result.data;
}
