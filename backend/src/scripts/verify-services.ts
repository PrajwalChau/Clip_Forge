import { spawn } from 'node:child_process';
import mongoose from 'mongoose';
import { Redis } from 'ioredis';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { getEnv } from '../config/env.js';

type Check = { status: 'passed' | 'failed' | 'skipped'; detail: string };

const commandCheck = async (command: string, args: string[]): Promise<Check> => new Promise((resolve) => {
  const child = spawn(command, args, { shell: false, stdio: 'ignore' });
  child.once('error', () => resolve({ status: 'failed', detail: 'command_unavailable' }));
  child.once('close', (code) => resolve(code === 0 ? { status: 'passed', detail: 'available' } : { status: 'failed', detail: 'command_failed' }));
});

const ffmpegFilterCheck = async (command: string): Promise<Check> => new Promise((resolve) => {
  const child = spawn(command, ['-hide_banner', '-filters'], { shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  child.once('error', () => resolve({ status: 'failed', detail: 'command_unavailable' }));
  child.once('close', (code) => {
    if (code !== 0) { resolve({ status: 'failed', detail: 'command_failed' }); return; }
    const hasDrawText = /\bdrawtext\b/.test(output);
    const hasSubtitles = /\bsubtitles\b/.test(output);
    resolve(hasDrawText && hasSubtitles ? { status: 'passed', detail: 'drawtext_and_subtitles_available' } : { status: 'failed', detail: `missing_${hasDrawText ? '' : 'drawtext'}${hasDrawText || hasSubtitles ? '' : '_and_'}${hasSubtitles ? '' : 'subtitles'}` });
  });
});

const failed = (error: unknown): Check => {
  const message = error instanceof Error ? error.message : '';
  if (/ECONNREFUSED/i.test(message)) return { status: 'failed', detail: 'connection_refused' };
  if (/ENOTFOUND|querySrv/i.test(message)) return { status: 'failed', detail: 'dns_unavailable' };
  if (/whitelist|not allowed|authentication failed|bad auth/i.test(message)) return { status: 'failed', detail: 'access_denied' };
  if (/timed out|timeout/i.test(message)) return { status: 'failed', detail: 'connection_timeout' };
  return { status: 'failed', detail: error instanceof Error ? error.name : 'UnknownError' };
};

const env = getEnv();
const checks: Record<string, Check> = {};

try {
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 8_000 });
  await mongoose.connection.db?.admin().ping();
  checks.mongodb = { status: 'passed', detail: 'ping' };
} catch (error) {
  checks.mongodb = failed(error);
} finally {
  await mongoose.disconnect().catch(() => undefined);
}

if (!env.REDIS_URL) {
  checks.redis = { status: 'skipped', detail: 'not_configured' };
} else {
  const redis = new Redis(env.REDIS_URL, { lazyConnect: true, connectTimeout: 8_000, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    checks.redis = (await redis.ping()) === 'PONG' ? { status: 'passed', detail: 'ping' } : { status: 'failed', detail: 'unexpected_reply' };
  } catch (error) {
    checks.redis = failed(error);
  } finally {
    redis.disconnect();
  }
}

checks.ffmpeg = await commandCheck(env.FFMPEG_PATH, ['-version']);
checks.ffprobe = await commandCheck(env.FFPROBE_PATH, ['-version']);
checks.ffmpegFilters = checks.ffmpeg.status === 'passed' ? await ffmpegFilterCheck(env.FFMPEG_PATH) : { status: 'skipped', detail: 'ffmpeg_unavailable' };
checks.whisper = env.TRANSCRIPTION_PROVIDER === 'whisper_local'
  ? await commandCheck(env.WHISPER_COMMAND, ['--help'])
  : { status: 'skipped', detail: `provider_${env.TRANSCRIPTION_PROVIDER}` };

if (env.R2_ENDPOINT && env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
  const client = new S3Client({
    region: 'auto',
    endpoint: env.R2_ENDPOINT,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY }
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: env.R2_BUCKET }));
    checks.r2 = { status: 'passed', detail: env.STORAGE_PROVIDER === 'r2' ? 'active_bucket_access' : 'bucket_access_storage_provider_local' };
  } catch (error) {
    checks.r2 = failed(error);
  }
} else {
  checks.r2 = { status: 'skipped', detail: 'not_configured' };
}

if (env.AI_PROVIDER === 'gemini' && env.AI_API_KEY) {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}?key=${encodeURIComponent(env.AI_API_KEY)}`);
    checks.gemini = response.ok ? { status: 'passed', detail: 'configured_model_available' } : { status: 'failed', detail: `http_${response.status}` };
  } catch (error) {
    checks.gemini = failed(error);
  }
} else if (env.AI_PROVIDER === 'none') {
  checks.gemini = { status: 'skipped', detail: 'transcript_fallback_active' };
} else {
  checks.gemini = { status: 'skipped', detail: 'not_configured' };
}

const mongoTarget = /(?:localhost|127\.0\.0\.1|\[::1\])/i.test(env.MONGODB_URI) ? 'local' : 'remote';
console.log(JSON.stringify({ queueMode: env.QUEUE_MODE, workerMode: env.WORKER_MODE, storageProvider: env.STORAGE_PROVIDER, mongoTarget, geminiModel: env.AI_PROVIDER === 'gemini' ? env.GEMINI_MODEL : undefined, checks }));
if (Object.values(checks).some((check) => check.status === 'failed')) process.exitCode = 1;
