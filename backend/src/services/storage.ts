import { access, copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, resolve, sep } from 'node:path';
import { S3Client, DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

export type StoredObject = { objectKey: string; sizeBytes: number };

export interface StorageService {
  putFromPath(objectKey: string, sourcePath: string): Promise<StoredObject>;
  copyToPath(objectKey: string, targetPath: string): Promise<void>;
  signedDownloadUrl(objectKey: string): Promise<string>;
  getLocalPath?(objectKey: string): string;
  delete(objectKey: string): Promise<void>;
}

const validateObjectKey = (objectKey: string): string => {
  if (!objectKey || objectKey.includes('..') || objectKey.startsWith('/') || objectKey.includes('\\')) {
    throw new AppError(400, 'INVALID_OBJECT_KEY', 'The storage object key is invalid.');
  }
  return objectKey;
};

class LocalStorageService implements StorageService {
  private readonly basePath: string;

  constructor(basePath: string) { this.basePath = resolve(basePath); }

  getLocalPath(objectKey: string): string {
    const path = resolve(this.basePath, validateObjectKey(objectKey));
    if (!path.startsWith(`${this.basePath}${sep}`)) throw new AppError(400, 'INVALID_OBJECT_KEY', 'The storage object key is invalid.');
    return path;
  }

  async putFromPath(objectKey: string, sourcePath: string): Promise<StoredObject> {
    const target = this.getLocalPath(objectKey);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(sourcePath, target);
    return { objectKey, sizeBytes: (await stat(target)).size };
  }

  async signedDownloadUrl(objectKey: string): Promise<string> {
    const filePath = this.getLocalPath(objectKey);
    await access(filePath);
    return `/api/v1/storage/local/${encodeURIComponent(objectKey)}`;
  }

  async copyToPath(objectKey: string, targetPath: string): Promise<void> {
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(this.getLocalPath(objectKey), targetPath);
  }

  async delete(objectKey: string): Promise<void> {
    await rm(this.getLocalPath(objectKey), { force: true });
  }
}

class R2StorageService implements StorageService {
  private readonly client: S3Client;
  constructor(private readonly bucket: string, env: Env) {
    this.client = new S3Client({ region: 'auto', endpoint: env.R2_ENDPOINT, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! } });
  }

  async putFromPath(objectKey: string, sourcePath: string): Promise<StoredObject> {
    const key = validateObjectKey(objectKey);
    const sourceStat = await stat(sourcePath);
    const { createReadStream } = await import('node:fs');
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: createReadStream(sourcePath), ContentLength: sourceStat.size }));
    return { objectKey: key, sizeBytes: sourceStat.size };
  }

  async signedDownloadUrl(objectKey: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: validateObjectKey(objectKey) }), { expiresIn: 300 });
  }

  async copyToPath(objectKey: string, targetPath: string): Promise<void> {
    const url = await this.signedDownloadUrl(objectKey);
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new AppError(502, 'STORAGE_READ_FAILED', 'The source video could not be retrieved from object storage.');
    await mkdir(dirname(targetPath), { recursive: true });
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(targetPath));
  }

  async delete(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: validateObjectKey(objectKey) }));
  }
}

export const createStorageService = (env: Env): StorageService => {
  if (env.STORAGE_PROVIDER === 'r2') return new R2StorageService(env.R2_BUCKET!, env);
  return new LocalStorageService(env.LOCAL_STORAGE_PATH);
};
