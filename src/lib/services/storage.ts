import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { config } from "@/lib/config";

let client: S3Client | undefined;

export function getStorageClient() {
  if (!client) {
    client = new S3Client({
      endpoint: config.services.s3Endpoint,
      region: config.services.s3Region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.services.s3AccessKey,
        secretAccessKey: config.services.s3SecretKey
      }
    });
  }
  return client;
}

export async function ensureBucket() {
  const s3 = getStorageClient();
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config.services.s3Bucket }));
  } catch (error) {
    const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (value.$metadata?.httpStatusCode !== 404 && !["NotFound", "NoSuchBucket"].includes(value.name ?? "")) throw error;
    try { await s3.send(new CreateBucketCommand({ Bucket: config.services.s3Bucket })); }
    catch (createError) {
      if (!["BucketAlreadyExists", "BucketAlreadyOwnedByYou"].includes((createError as { name?: string }).name ?? "")) throw createError;
    }
  }
}

export async function putObject(key: string, body: Uint8Array | string, contentType: string) {
  await getStorageClient().send(new PutObjectCommand({
    Bucket: config.services.s3Bucket,
    Key: key,
    Body: body,
    ContentType: contentType
  }));
  return key;
}

export async function getObject(key: string) {
  const response = await getStorageClient().send(new GetObjectCommand({
    Bucket: config.services.s3Bucket,
    Key: key
  }));
  if (!response.Body) throw new Error(`Object ${key} has no body`);
  return response.Body.transformToByteArray();
}
