import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Config } from "../config";

export type StorageConfig = Pick<
  Config,
  | "S3_ENDPOINT"
  | "S3_PUBLIC_ENDPOINT"
  | "S3_REGION"
  | "S3_BUCKET"
  | "S3_ACCESS_KEY"
  | "S3_SECRET_KEY"
  | "S3_FORCE_PATH_STYLE"
>;

export interface Storage {
  bucket: string;
  ensureBucket: () => Promise<boolean>;
  put: (key: string, body: Uint8Array, contentType: string) => Promise<void>;
  get: (key: string) => Promise<Uint8Array | null>;
  remove: (key: string) => Promise<void>;
  signedUrl: (key: string, expiresInSeconds?: number) => Promise<string>;
}

export function documentStorageKey(documentTypeSlug: string, sha256: string): string {
  return `${documentTypeSlug}/${sha256.slice(0, 2)}/${sha256}.pdf`;
}

function clientConfig(config: StorageConfig, endpoint: string): S3ClientConfig {
  return {
    endpoint,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
    },
  };
}

function isStatus(error: unknown, status: number): boolean {
  return error instanceof S3ServiceException && error.$metadata.httpStatusCode === status;
}

export function createStorage(config: StorageConfig): Storage {
  const bucket = config.S3_BUCKET;
  const client = new S3Client(clientConfig(config, config.S3_ENDPOINT));
  // Signed URLs are opened by the browser, so they must use a host it can reach
  const publicClient = new S3Client(
    clientConfig(config, config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT),
  );

  return {
    bucket,

    async ensureBucket() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
        return false;
      } catch (error) {
        if (!isStatus(error, 404)) {
          throw error;
        }
      }

      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      return true;
    },

    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },

    async get(key) {
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return (await response.Body?.transformToByteArray()) ?? null;
      } catch (error) {
        if (error instanceof NoSuchKey || isStatus(error, 404)) {
          return null;
        }
        throw error;
      }
    },

    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    signedUrl(key, expiresInSeconds = 900) {
      return getSignedUrl(publicClient, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: expiresInSeconds,
      });
    },
  };
}
