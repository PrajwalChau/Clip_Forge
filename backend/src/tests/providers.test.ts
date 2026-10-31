import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import { selectClips, transcribe } from '../services/providers.js';
import { sourceUploadSchema } from '../controllers/storage.js';

const env: Env = {
  NODE_ENV: 'test', PORT: 4000, MONGODB_URI: 'mongodb://example.invalid/clipforge', JWT_SECRET: 'provider-test-secret-must-be-at-least-thirty-two-characters', COOKIE_SECURE: false, FRONTEND_URL: 'http://localhost:5173', QUEUE_MODE: 'inline', WORKER_MODE: 'embedded', WORKER_CONCURRENCY: 1, STORAGE_PROVIDER: 'local', LOCAL_STORAGE_PATH: './test-storage', MAX_UPLOAD_BYTES: 10_000, MAX_VIDEO_DURATION_SECONDS: 600, MAX_OUTPUT_BYTES: 10_000, MAX_CLIPS_PER_JOB: 5, TEMP_FILE_MAX_AGE_HOURS: 24, FFMPEG_PATH: 'ffmpeg', FFPROBE_PATH: 'ffprobe', WHISPER_COMMAND: 'whisper', WHISPER_MODEL: 'base', TRANSCRIPTION_PROVIDER: 'mock', AI_PROVIDER: 'none', GEMINI_MODEL: 'gemini-2.5-flash', VIDEO_PROCESSING_MODE: 'demo', PAYMENTS_MODE: 'disabled'
};

describe('source metadata and provider fallbacks', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('allows source registration without a rights declaration and records declarations when provided', () => {
    expect(sourceUploadSchema.parse({ projectId: 'project-id' })).toMatchObject({ rightsConfirmed: false, licenseType: 'unknown' });
    expect(sourceUploadSchema.parse({ projectId: 'project-id', rightsConfirmed: 'true', licenseType: 'cc_by_nc' })).toMatchObject({ rightsConfirmed: true, licenseType: 'cc_by_nc' });
  });

  it('labels mock transcription and fallback selections honestly', async () => {
    const transcript = await transcribe('/not-read-in-mock-mode.mp4', 90, env);
    expect(transcript).toMatchObject({ provider: 'mock', isDemo: true });
    const clips = await selectClips(transcript.segments, 90, 2, env);
    expect(clips).toHaveLength(2);
    expect(clips.every((clip) => clip.mode === 'mock' && clip.endSeconds > clip.startSeconds)).toBe(true);
  });

  it('uses a distinctly labelled transcript fallback when AI selection is not configured in real mode', async () => {
    const clips = await selectClips([{ startSeconds: 0, endSeconds: 20, text: 'A complete useful thought for a fallback clip.' }, { startSeconds: 30, endSeconds: 55, text: 'Another distinct thought for a second fallback clip.' }], 60, 2, { ...env, VIDEO_PROCESSING_MODE: 'real', AI_PROVIDER: 'none' });
    expect(clips.map((clip) => clip.mode)).toEqual(['fallback', 'fallback']);
  });

  it('falls back to the timestamped transcript when Gemini rejects a selection request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'request rejected' } }), { status: 429 })));
    const clips = await selectClips([{ startSeconds: 0, endSeconds: 20, text: 'A complete useful thought for a fallback clip.' }, { startSeconds: 30, endSeconds: 55, text: 'Another distinct thought for a second fallback clip.' }], 60, 2, { ...env, VIDEO_PROCESSING_MODE: 'real', AI_PROVIDER: 'gemini', AI_API_KEY: 'test-key' });
    expect(clips.map((clip) => clip.mode)).toEqual(['fallback', 'fallback']);
  });

  it('enforces 15-second default duration, supports 30-second option, handles end boundaries, and short videos safely', async () => {
    // 15-second default
    const defaultClips = await selectClips([{ startSeconds: 10, endSeconds: 40, text: 'Segment 1' }], 100, 1, { ...env, VIDEO_PROCESSING_MODE: 'real', AI_PROVIDER: 'none' });
    expect(defaultClips[0]!.endSeconds - defaultClips[0]!.startSeconds).toBe(15);

    // 30-second option preserved
    const thirtySecClips = await selectClips([{ startSeconds: 10, endSeconds: 60, text: 'Segment 1' }], 100, 1, { ...env, VIDEO_PROCESSING_MODE: 'real', AI_PROVIDER: 'none' }, undefined, 30);
    expect(thirtySecClips[0]!.endSeconds - thirtySecClips[0]!.startSeconds).toBe(30);

    // End boundary: segment at second 95 of a 100s video
    const boundaryClips = await selectClips([{ startSeconds: 95, endSeconds: 100, text: 'End segment' }], 100, 1, { ...env, VIDEO_PROCESSING_MODE: 'real', AI_PROVIDER: 'none' }, undefined, 15);
    expect(boundaryClips[0]!.endSeconds).toBe(100);
    expect(boundaryClips[0]!.startSeconds).toBe(85);
    expect(boundaryClips[0]!.endSeconds - boundaryClips[0]!.startSeconds).toBe(15);

    // Short video: source video is only 10s (shorter than 15s)
    const shortVideoClips = await selectClips([{ startSeconds: 0, endSeconds: 10, text: 'Short video' }], 10, 1, { ...env, VIDEO_PROCESSING_MODE: 'real', AI_PROVIDER: 'none' }, undefined, 15);
    expect(shortVideoClips[0]!.startSeconds).toBe(0);
    expect(shortVideoClips[0]!.endSeconds).toBe(10);
    expect(shortVideoClips[0]!.endSeconds - shortVideoClips[0]!.startSeconds).toBe(10);
  });
});
