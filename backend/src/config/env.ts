import 'dotenv/config';
import { z } from 'zod';
import { AppError } from '../utils/errors.js';

const optionalUrl = z.preprocess((value) => value === '' ? undefined : value, z.string().url().optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  REDIS_URL: z.string().url().optional(),
  QUEUE_MODE: z.enum(['bullmq', 'inline']).default('bullmq'),
  WORKER_MODE: z.enum(['embedded', 'separate']).default('embedded'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  STORAGE_PROVIDER: z.enum(['local', 'r2']).default('local'),
  LOCAL_STORAGE_PATH: z.string().default('./storage'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(2_147_483_648),
  MAX_VIDEO_DURATION_SECONDS: z.coerce.number().int().positive().default(14_400),
  MAX_OUTPUT_BYTES: z.coerce.number().int().positive().default(1_073_741_824),
  MAX_CLIPS_PER_JOB: z.coerce.number().int().min(1).max(10).default(5),
  TEMP_FILE_MAX_AGE_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  WHISPER_COMMAND: z.string().default('whisper'),
  WHISPER_MODEL: z.string().default('base'),
  TRANSCRIPTION_PROVIDER: z.enum(['none', 'openai', 'whisper_local', 'mock']).default('none'),
  TRANSCRIPTION_API_KEY: z.string().optional(),
  AI_PROVIDER: z.enum(['none', 'gemini', 'mock']).default('none'),
  AI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().trim().min(1).default('gemini-2.5-flash'),
  VIDEO_PROCESSING_MODE: z.enum(['real', 'demo']).default('real'),
  R2_ENDPOINT: optionalUrl,
  R2_BUCKET: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  PAYMENTS_MODE: z.enum(['disabled', 'test', 'live']).default('disabled'),
  ESEWA_PRODUCT_CODE: z.string().optional(),
  ESEWA_SECRET_KEY: z.string().optional(),
  KHALTI_SECRET_KEY: z.string().optional(),
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  YOUTUBE_API_KEY: z.string().optional(),
  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_REDIRECT_URI: optionalUrl,
  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  TIKTOK_REDIRECT_URI: optionalUrl,
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_REDIRECT_URI: optionalUrl
}).superRefine((value, ctx) => {
  if (value.QUEUE_MODE === 'bullmq' && !value.REDIS_URL) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'REDIS_URL is required when QUEUE_MODE=bullmq', path: ['REDIS_URL'] });
  }
  if (value.STORAGE_PROVIDER === 'r2' && (!value.R2_ENDPOINT || !value.R2_BUCKET || !value.R2_ACCESS_KEY_ID || !value.R2_SECRET_ACCESS_KEY)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'R2 endpoint, bucket, and credentials are required when STORAGE_PROVIDER=r2', path: ['STORAGE_PROVIDER'] });
  }
  if (value.TRANSCRIPTION_PROVIDER === 'openai' && !value.TRANSCRIPTION_API_KEY) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'TRANSCRIPTION_API_KEY is required when TRANSCRIPTION_PROVIDER=openai', path: ['TRANSCRIPTION_API_KEY'] });
  }
  if (value.AI_PROVIDER === 'gemini' && !value.AI_API_KEY) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'AI_API_KEY is required when AI_PROVIDER=gemini', path: ['AI_API_KEY'] });
  }
  if (value.NODE_ENV === 'production' && !value.COOKIE_SECURE) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'COOKIE_SECURE must be true in production', path: ['COOKIE_SECURE'] });
  }
  if (value.NODE_ENV === 'production' && (!value.TOKEN_ENCRYPTION_KEY || value.TOKEN_ENCRYPTION_KEY.trim().length < 32)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'TOKEN_ENCRYPTION_KEY is required and must be at least 32 characters in production', path: ['TOKEN_ENCRYPTION_KEY'] });
  }
  if ([value.YOUTUBE_CLIENT_ID, value.YOUTUBE_CLIENT_SECRET, value.TIKTOK_CLIENT_KEY, value.TIKTOK_CLIENT_SECRET, value.META_APP_ID, value.META_APP_SECRET].some(Boolean) && (!value.TOKEN_ENCRYPTION_KEY || value.TOKEN_ENCRYPTION_KEY.trim().length < 32)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'TOKEN_ENCRYPTION_KEY is required to securely store OAuth tokens when any social integration is configured', path: ['TOKEN_ENCRYPTION_KEY'] });
  }
  if (value.NODE_ENV === 'production' && value.VIDEO_PROCESSING_MODE === 'demo') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'VIDEO_PROCESSING_MODE=demo is not permitted in production', path: ['VIDEO_PROCESSING_MODE'] });
  }
  if (value.NODE_ENV === 'production' && (value.TRANSCRIPTION_PROVIDER === 'mock' || value.AI_PROVIDER === 'mock')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Mock AI providers are not permitted in production', path: ['TRANSCRIPTION_PROVIDER'] });
  }
});

export type Env = z.infer<typeof schema>;

export const getEnv = (): Env => {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment configuration — ${details}`);
  }
  return parsed.data;
};

export const getTokenEncryptionKey = (env: Env): string => {
  if (!env.TOKEN_ENCRYPTION_KEY || env.TOKEN_ENCRYPTION_KEY.trim().length < 32) {
    throw new AppError(500, 'TOKEN_ENCRYPTION_KEY_MISSING', 'TOKEN_ENCRYPTION_KEY is required and must be at least 32 characters long.');
  }
  return env.TOKEN_ENCRYPTION_KEY;
};
