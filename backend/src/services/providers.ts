import { basename, dirname, join } from 'node:path';
import { openAsBlob } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

export type TranscriptSegment = { startSeconds: number; endSeconds: number; text: string };
export type TranscriptionResult = { provider: 'openai' | 'whisper_local' | 'mock'; isDemo: boolean; language?: string; segments: TranscriptSegment[] };
export type ClipSuggestion = { startSeconds: number; endSeconds: number; title: string; summary: string; selectionReason: string; score: number; suggestedCaption?: string; topic?: string; mode: 'ai' | 'fallback' | 'mock' };

const transcriptSegments = (segments: Array<{ start?: number; end?: number; text?: string }>): TranscriptSegment[] => segments
  .map((segment) => ({ startSeconds: Number(segment.start), endSeconds: Number(segment.end), text: segment.text?.trim() ?? '' }))
  .filter((segment) => Number.isFinite(segment.startSeconds) && Number.isFinite(segment.endSeconds) && segment.startSeconds >= 0 && segment.endSeconds > segment.startSeconds && segment.text.length > 0);

const demoTranscript = (sourceDurationSeconds: number): TranscriptionResult => {
  const duration = Math.max(30, sourceDurationSeconds);
  const window = Math.min(30, Math.max(10, Math.floor(duration / 3)));
  return {
    provider: 'mock', isDemo: true,
    segments: [
      { startSeconds: 0, endSeconds: Math.min(window, duration), text: 'Demo transcript segment. Configure a local Whisper runtime or a supported transcription provider for real speech-to-text.' },
      { startSeconds: Math.min(window, duration), endSeconds: Math.min(window * 2, duration), text: 'Demo analysis preserves the media workflow but does not represent the spoken content of the uploaded video.' },
      { startSeconds: Math.min(window * 2, duration), endSeconds: duration, text: 'Use real processing mode before relying on transcript content, captions, or AI recommendations.' }
    ].filter((segment) => segment.endSeconds > segment.startSeconds)
  };
};

const cancellationError = (): AppError => new AppError(409, 'JOB_CANCELLED', 'This processing job was cancelled.');

const runWhisper = async (sourcePath: string, env: Env, signal?: AbortSignal): Promise<TranscriptionResult> => new Promise((resolve, reject) => {
  const outputDirectory = dirname(sourcePath);
  const process = spawn(env.WHISPER_COMMAND, [sourcePath, '--model', env.WHISPER_MODEL, '--output_format', 'json', '--output_dir', outputDirectory, '--fp16', 'False'], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  let settled = false;
  const settle = (callback: () => void): void => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); callback(); };
  const cancel = (): void => { process.kill('SIGKILL'); settle(() => reject(cancellationError())); };
  const timer = setTimeout(() => { process.kill('SIGKILL'); settle(() => reject(new AppError(504, 'TRANSCRIPTION_TIMEOUT', 'Local Whisper did not finish before the worker timeout.'))); }, 90 * 60 * 1_000);
  if (signal?.aborted) { cancel(); return; }
  signal?.addEventListener('abort', cancel, { once: true });
  process.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  process.on('error', () => { settle(() => reject(new AppError(503, 'WHISPER_UNAVAILABLE', `Local Whisper is not available. Install openai-whisper and ensure ${env.WHISPER_COMMAND} is on the worker PATH.`))); });
  process.on('close', async (code) => {
    if (settled) return;
    if (code !== 0) { settle(() => reject(new AppError(502, 'WHISPER_FAILED', 'Local Whisper could not transcribe this video.', stderr.slice(-500)))); return; }
    try {
      const transcriptPath = join(outputDirectory, `${basename(sourcePath).replace(/\.[^.]+$/, '')}.json`);
      const parsed = JSON.parse(await readFile(transcriptPath, 'utf8')) as { language?: string; segments?: Array<{ start?: number; end?: number; text?: string }> };
      const segments = transcriptSegments(parsed.segments ?? []);
      if (segments.length === 0) throw new AppError(422, 'TRANSCRIPT_EMPTY', 'Local Whisper did not return usable timestamped speech segments.');
      settle(() => resolve({ provider: 'whisper_local', isDemo: false, language: parsed.language, segments }));
    } catch (error) { settle(() => reject(error instanceof AppError ? error : new AppError(502, 'WHISPER_INVALID_OUTPUT', 'Local Whisper produced an unreadable transcript output.'))); }
  });
});

export const transcribe = async (sourcePath: string, sourceDurationSeconds: number, env: Env, signal?: AbortSignal): Promise<TranscriptionResult> => {
  if (signal?.aborted) throw cancellationError();
  if (env.TRANSCRIPTION_PROVIDER === 'mock' || (env.TRANSCRIPTION_PROVIDER === 'none' && env.VIDEO_PROCESSING_MODE === 'demo')) return demoTranscript(sourceDurationSeconds);
  if (env.TRANSCRIPTION_PROVIDER === 'none') throw new AppError(503, 'TRANSCRIPTION_NOT_CONFIGURED', 'Transcription is not configured. Install local Whisper or configure a supported provider before real processing.');
  if (env.TRANSCRIPTION_PROVIDER === 'whisper_local') return runWhisper(sourcePath, env, signal);
  if (!env.TRANSCRIPTION_API_KEY) throw new AppError(503, 'TRANSCRIPTION_NOT_CONFIGURED', 'The configured transcription provider is missing its API key.');
  const form = new FormData();
  const file = await openAsBlob(sourcePath);
  form.set('file', file, 'source.mp4');
  form.set('model', 'gpt-4o-mini-transcribe');
  form.set('response_format', 'verbose_json');
  let response: Response;
  try { response = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${env.TRANSCRIPTION_API_KEY}` }, body: form, signal }); } catch (error) { if (signal?.aborted) throw cancellationError(); throw error; }
  if (!response.ok) throw new AppError(502, 'TRANSCRIPTION_PROVIDER_ERROR', 'The transcription provider rejected the request.');
  const result = await response.json() as { language?: string; segments?: Array<{ start?: number; end?: number; text?: string }> };
  const segments = transcriptSegments(result.segments ?? []);
  if (segments.length === 0) throw new AppError(422, 'TRANSCRIPT_EMPTY', 'The transcription provider did not return any usable speech segments.');
  return { provider: 'openai', isDemo: false, language: result.language, segments };
};

const rawClipSchema = z.object({
  startSeconds: z.number().finite(), endSeconds: z.number().finite(), title: z.string().trim().min(1).max(160), summary: z.string().trim().min(1).max(1_000), selectionReason: z.string().trim().min(1).max(1_000), score: z.number().finite().min(0).max(100), suggestedCaption: z.string().trim().max(1_000).optional(), topic: z.string().trim().max(120).optional()
});

const distinctWindows = (clips: ClipSuggestion[], requestedCount: number): ClipSuggestion[] => {
  const accepted: ClipSuggestion[] = [];
  for (const clip of clips) {
    const overlaps = accepted.some((existing) => {
      const overlap = Math.max(0, Math.min(existing.endSeconds, clip.endSeconds) - Math.max(existing.startSeconds, clip.startSeconds));
      return overlap / Math.min(existing.endSeconds - existing.startSeconds, clip.endSeconds - clip.startSeconds) > 0.7;
    });
    if (!overlaps) accepted.push(clip);
    if (accepted.length === requestedCount) break;
  }
  return accepted;
};

const fallbackSelect = (segments: TranscriptSegment[], sourceDurationSeconds: number, requestedCount: number, mode: 'fallback' | 'mock', targetDurationSeconds = 15): ClipSuggestion[] => {
  const windows: ClipSuggestion[] = [];
  const target = Math.min(sourceDurationSeconds, Math.max(15, targetDurationSeconds));
  const minClipDuration = Math.min(15, sourceDurationSeconds);
  for (const segment of segments) {
    const rawStart = Math.max(0, segment.startSeconds);
    const startSeconds = Math.max(0, Math.min(rawStart, sourceDurationSeconds - target));
    const endSeconds = Math.min(sourceDurationSeconds, startSeconds + target);
    if (endSeconds - startSeconds < minClipDuration) continue;
    windows.push({ startSeconds, endSeconds, title: mode === 'mock' ? 'Demo clip window' : 'Transcript-based clip window', summary: segment.text, selectionReason: mode === 'mock' ? 'Generated by explicitly enabled demo processing, not real AI analysis.' : 'Generated from timestamped transcript because AI selection was unavailable.', score: 0, suggestedCaption: segment.text, topic: 'Unclassified', mode });
  }
  const distinct = distinctWindows(windows, requestedCount);
  if (distinct.length < requestedCount && sourceDurationSeconds > 0) {
    const step = requestedCount > 1 ? Math.max(1, Math.floor((sourceDurationSeconds - target) / (requestedCount - 1))) : 0;
    for (let i = 0; i < requestedCount && distinct.length < requestedCount; i++) {
      const startSeconds = Math.max(0, Math.min(i * step, sourceDurationSeconds - target));
      const endSeconds = Math.min(sourceDurationSeconds, startSeconds + target);
      if (endSeconds - startSeconds >= minClipDuration) {
        const candidate: ClipSuggestion = {
          startSeconds,
          endSeconds,
          title: mode === 'mock' ? 'Demo clip window' : 'Transcript-based clip window',
          summary: 'Fallback selection window',
          selectionReason: mode === 'mock' ? 'Generated by explicitly enabled demo processing, not real AI analysis.' : 'Generated from video timeline because few transcript cues were available.',
          score: 0,
          suggestedCaption: '',
          topic: 'Unclassified',
          mode
        };
        const overlaps = distinct.some((existing) => {
          const overlap = Math.max(0, Math.min(existing.endSeconds, candidate.endSeconds) - Math.max(existing.startSeconds, candidate.startSeconds));
          return overlap / Math.min(existing.endSeconds - existing.startSeconds, candidate.endSeconds - candidate.startSeconds) > 0.7;
        });
        if (!overlaps) distinct.push(candidate);
      }
    }
  }
  return distinct;
};

export const selectClips = async (segments: TranscriptSegment[], sourceDurationSeconds: number, requestedCount: number, env: Env, signal?: AbortSignal, targetDurationSeconds = 15): Promise<ClipSuggestion[]> => {
  if (signal?.aborted) throw cancellationError();
  const target = Math.min(sourceDurationSeconds, Math.max(15, targetDurationSeconds));
  const minClipDuration = Math.min(15, sourceDurationSeconds);
  if (env.AI_PROVIDER === 'mock' || (env.AI_PROVIDER === 'none' && env.VIDEO_PROCESSING_MODE === 'demo')) {
    const suggestions = fallbackSelect(segments, sourceDurationSeconds, requestedCount, 'mock', targetDurationSeconds);
    if (suggestions.length === 0) throw new AppError(422, 'CLIP_SELECTION_EMPTY', 'The demo transcript did not contain usable clip windows.');
    return suggestions;
  }
  if (env.AI_PROVIDER === 'none' || !env.AI_API_KEY) {
    const suggestions = fallbackSelect(segments, sourceDurationSeconds, requestedCount, 'fallback', targetDurationSeconds);
    if (suggestions.length === 0) throw new AppError(503, 'CLIP_AI_NOT_CONFIGURED', 'AI clip selection is not configured and transcript fallback could not choose a valid window.');
    return suggestions;
  }
  const useTranscriptFallback = (): ClipSuggestion[] => {
    const suggestions = fallbackSelect(segments, sourceDurationSeconds, requestedCount, 'fallback', targetDurationSeconds);
    if (suggestions.length === 0) throw new AppError(503, 'CLIP_AI_AND_FALLBACK_UNAVAILABLE', 'AI clip selection was unavailable and the transcript did not contain usable clip windows.');
    return suggestions;
  };
  const prompt = `Choose up to ${requestedCount} coherent short-form clip windows from this timestamped transcript. Return JSON only: {"clips":[{"startSeconds":number,"endSeconds":number,"title":string,"summary":string,"selectionReason":string,"score":number,"suggestedCaption":string,"topic":string}]}. Score is an estimated clip-quality score, never a virality prediction. Target clips of approximately ${target} seconds (keep each clip between ${minClipDuration} and ${Math.min(180, Math.max(target + 5, 30))} seconds), avoid duplicate or highly overlapping windows, preserve sentence context, and stay inside duration ${sourceDurationSeconds}. Transcript: ${JSON.stringify(segments)}`;
  let response: Response;
  try { response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(env.AI_API_KEY)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } }), signal }); } catch { if (signal?.aborted) throw cancellationError(); return useTranscriptFallback(); }
  if (!response.ok) return useTranscriptFallback();
  const result = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const raw = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) return useTranscriptFallback();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return useTranscriptFallback(); }
  const candidateResult = z.object({ clips: z.array(rawClipSchema).max(requestedCount * 3) }).safeParse(parsed);
  if (!candidateResult.success) return useTranscriptFallback();
  const valid = candidateResult.data.clips
    .filter((clip) => clip.startSeconds >= 0 && clip.endSeconds > clip.startSeconds && clip.endSeconds <= sourceDurationSeconds && clip.endSeconds - clip.startSeconds >= minClipDuration && clip.endSeconds - clip.startSeconds <= 180)
    .map((clip) => {
      const clipDuration = Math.min(sourceDurationSeconds, target);
      const startSeconds = Math.max(0, Math.min(clip.startSeconds, sourceDurationSeconds - clipDuration));
      const endSeconds = startSeconds + clipDuration;
      return { ...clip, startSeconds, endSeconds, mode: 'ai' as const };
    });
  const clips = distinctWindows(valid, requestedCount);
  if (clips.length === 0) return useTranscriptFallback();
  return clips;
};
