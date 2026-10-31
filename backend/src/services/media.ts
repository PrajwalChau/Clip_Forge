import { spawn } from 'node:child_process';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

export type MediaMetadata = { durationSeconds: number; width: number; height: number; hasAudio: boolean; formatName: string };
export type QualityCheck = { name: string; passed: boolean; detail: string };

const execute = async (binary: string, args: string[], timeoutMs = 10 * 60 * 1000, signal?: AbortSignal): Promise<string> => new Promise((resolve, reject) => {
  const process = spawn(binary, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let settled = false;
  const settle = (callback: () => void): void => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); callback(); };
  const cancel = (): void => { process.kill('SIGKILL'); settle(() => reject(new AppError(409, 'JOB_CANCELLED', 'This processing job was cancelled.'))); };
  const timer = setTimeout(() => { process.kill('SIGKILL'); settle(() => reject(new AppError(504, 'MEDIA_TIMEOUT', 'Media processing took too long and was stopped.'))); }, timeoutMs);
  if (signal?.aborted) { cancel(); return; }
  signal?.addEventListener('abort', cancel, { once: true });
  process.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
  process.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  process.on('error', () => { settle(() => reject(new AppError(503, 'MEDIA_TOOLS_UNAVAILABLE', 'FFmpeg or FFprobe is not available on this server.'))); });
  process.on('close', (code) => {
    if (settled) return;
    if (code === 0) settle(() => resolve(stdout));
    else settle(() => reject(new AppError(422, 'MEDIA_COMMAND_FAILED', 'The video could not be processed safely.', stderr.slice(-1000))));
  });
});

export const probeVideo = async (path: string, env: Env): Promise<MediaMetadata> => {
  const output = await execute(env.FFPROBE_PATH, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration,format_name', '-of', 'json', path], 60_000);
  const parsed = JSON.parse(output) as { streams?: Array<{ codec_type?: string; width?: number; height?: number }>; format?: { duration?: string; format_name?: string } };
  const stream = parsed.streams?.find((candidate) => candidate.codec_type === 'video');
  const durationSeconds = Number(parsed.format?.duration);
  const formatName = parsed.format?.format_name ?? '';
  if (!stream?.width || !stream.height || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || !formatName.includes('mp4')) throw new AppError(422, 'INVALID_MEDIA', 'The uploaded file is not a valid MP4 video with a readable video stream.');
  if (durationSeconds > env.MAX_VIDEO_DURATION_SECONDS) throw new AppError(422, 'MEDIA_TOO_LONG', 'This video exceeds the configured duration limit.');
  return { durationSeconds, width: stream.width, height: stream.height, hasAudio: parsed.streams?.some((candidate) => candidate.codec_type === 'audio') ?? false, formatName };
};

export const makeJobTempDirectory = async (jobId: string): Promise<string> => {
  const safeId = jobId.replace(/[^a-zA-Z0-9_-]/g, '');
  const dir = join(process.cwd(), 'tmp', `${safeId}-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
};

export const removeJobTempDirectory = async (dir: string): Promise<void> => { await rm(dir, { recursive: true, force: true }); };

export const cleanupStaleJobTempDirectories = async (maxAgeHours: number, activeJobIds: Set<string>): Promise<number> => {
  const root = join(process.cwd(), 'tmp');
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1_000;
  let removed = 0;
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const jobId = entry.name.split('-')[0] ?? '';
    if (activeJobIds.has(jobId)) continue;
    const path = join(root, entry.name);
    const details = await stat(path).catch(() => undefined);
    if (details && details.mtimeMs < cutoff) { await rm(path, { recursive: true, force: true }); removed += 1; }
  }
  return removed;
};

export const writeClipSubtitles = async (outputDir: string, startSeconds: number, endSeconds: number, segments: Array<{ startSeconds: number; endSeconds: number; text: string }>): Promise<string | undefined> => {
  const toTimestamp = (seconds: number): string => {
    const milliseconds = Math.max(0, Math.round(seconds * 1000));
    const hours = Math.floor(milliseconds / 3_600_000);
    const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
    const secs = Math.floor((milliseconds % 60_000) / 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(milliseconds % 1000).padStart(3, '0')}`;
  };
  const entries = segments.filter((segment) => segment.endSeconds > startSeconds && segment.startSeconds < endSeconds).map((segment, index) => `${index + 1}\n${toTimestamp(Math.max(0, segment.startSeconds - startSeconds))} --> ${toTimestamp(Math.min(endSeconds, segment.endSeconds) - startSeconds)}\n${segment.text.replace(/\r?\n/g, ' ').trim()}\n`);
  if (entries.length === 0) return undefined;
  const path = join(outputDir, `${randomUUID()}.srt`);
  await writeFile(path, entries.join('\n'), 'utf8');
  return path;
};

export const renderVerticalClip = async (inputPath: string, outputDir: string, startSeconds: number, endSeconds: number, height: 720 | 1080, watermark: boolean, subtitlePath: string | undefined, env: Env, signal?: AbortSignal): Promise<string> => {
  const outputPath = join(outputDir, `${basename(inputPath).replace(/\.[^.]+$/, '')}-${randomUUID()}.mp4`);
  const duration = endSeconds - startSeconds;
  const outputWidth = Math.floor((height * 9 / 16) / 2) * 2;
  const filters = [
    `scale=-2:${height}:force_original_aspect_ratio=increase`,
    `crop=${outputWidth}:${height}`,
    'setsar=1'
  ];
  if (subtitlePath) filters.push(`subtitles='${subtitlePath.replace(/'/g, "\\\\'").replace(/:/g, '\\:')}':force_style='FontName=Arial,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Alignment=2,MarginV=72'`);
  if (watermark) filters.push("drawtext=text='ClipForge':x=w-tw-32:y=h-th-32:fontsize=24:fontcolor=white@0.8:box=1:boxcolor=black@0.35:boxborderw=8");
  await execute(env.FFMPEG_PATH, ['-hide_banner', '-y', '-ss', String(startSeconds), '-i', inputPath, '-t', String(duration), '-map', '0:v:0', '-map', '0:a?', '-vf', filters.join(','), '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-c:a', 'aac', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-movflags', '+faststart', outputPath], 20 * 60 * 1000, signal);
  return outputPath;
};

export const renderFullVideoActiveSpeakerClip = async (inputPath: string, outputDir: string, startSeconds: number, endSeconds: number, height: 720 | 1080, watermark: boolean, subtitlePath: string | undefined, env: Env, signal?: AbortSignal): Promise<string> => {
  const outputPath = join(outputDir, `${basename(inputPath).replace(/\.[^.]+$/, '')}-speaker-layout-${randomUUID()}.mp4`);
  const duration = endSeconds - startSeconds;
  const outputWidth = Math.floor((height * 9 / 16) / 2) * 2;
  const upperHeight = Math.floor((height * 0.55) / 2) * 2;
  const lowerHeight = height - upperHeight;
  const filters = [
    '[0:v]split=2[full][close]',
    `[full]scale=${outputWidth}:${upperHeight}:force_original_aspect_ratio=decrease,pad=${outputWidth}:${upperHeight}:(ow-iw)/2:(oh-ih)/2:color=0x15161b[upper]`,
    `[close]scale=${outputWidth}:${lowerHeight}:force_original_aspect_ratio=increase,crop=${outputWidth}:${lowerHeight}:(in_w-out_w)/2:(in_h-out_h)/2[lower]`,
    '[upper][lower]vstack=inputs=2[stacked]'
  ];
  let outputLabel = 'stacked';
  if (subtitlePath) {
    filters.push(`[${outputLabel}]subtitles='${subtitlePath.replace(/'/g, "\\\\'").replace(/:/g, '\\:')}':force_style='FontName=Arial,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Alignment=8,MarginV=${Math.max(28, upperHeight - 64)}'[captioned]`);
    outputLabel = 'captioned';
  }
  if (watermark) {
    filters.push(`[${outputLabel}]drawtext=text='ClipForge':x=w-tw-24:y=h-th-20:fontsize=22:fontcolor=white@0.8:box=1:boxcolor=black@0.35:boxborderw=7[final]`);
    outputLabel = 'final';
  }
  await execute(env.FFMPEG_PATH, ['-hide_banner', '-y', '-ss', String(startSeconds), '-i', inputPath, '-t', String(duration), '-filter_complex', filters.join(';'), '-map', `[${outputLabel}]`, '-map', '0:a?', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-c:a', 'aac', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-movflags', '+faststart', outputPath], 20 * 60 * 1_000, signal);
  return outputPath;
};

const blackDurationInSample = async (path: string, sampleSeconds: number, env: Env): Promise<number> => new Promise((resolve, reject) => {
  const process = spawn(env.FFMPEG_PATH, ['-hide_banner', '-ss', '0', '-t', String(sampleSeconds), '-i', path, '-vf', 'blackdetect=d=0.2:pix_th=0.10', '-an', '-f', 'null', '-'], { shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  const timer = setTimeout(() => { process.kill('SIGKILL'); reject(new AppError(504, 'QUALITY_CHECK_TIMEOUT', 'The output quality check timed out.')); }, 90_000);
  process.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  process.on('error', () => { clearTimeout(timer); reject(new AppError(503, 'MEDIA_TOOLS_UNAVAILABLE', 'FFmpeg is required for output validation.')); });
  process.on('close', (code) => {
    clearTimeout(timer);
    if (code !== 0) { reject(new AppError(422, 'QUALITY_CHECK_FAILED', 'The rendered video could not be inspected.')); return; }
    const total = [...stderr.matchAll(/black_duration:([0-9.]+)/g)].reduce((sum, match) => sum + Number(match[1]), 0);
    resolve(total);
  });
});

export const verifyRenderedClip = async (path: string, expected: { durationSeconds: number; height: 720 | 1080; expectsAudio: boolean; subtitlesEnabled: boolean; subtitlePath?: string }, env: Env): Promise<QualityCheck[]> => {
  const checks: QualityCheck[] = [];
  const file = await stat(path).catch(() => undefined);
  checks.push({ name: 'output_file', passed: Boolean(file && file.size > 0), detail: file?.size ? `${file.size} bytes` : 'The output file is missing or empty.' });
  if (!file?.size) throw new AppError(422, 'QUALITY_FILE_MISSING', 'The rendered file is missing or empty.');
  if (file.size > env.MAX_OUTPUT_BYTES) throw new AppError(422, 'QUALITY_OUTPUT_TOO_LARGE', 'The rendered clip exceeds the configured output-size limit.');
  checks.push({ name: 'output_size', passed: true, detail: `${file.size} bytes within the configured limit` });
  const metadata = await probeVideo(path, env);
  const durationMatches = Math.abs(metadata.durationSeconds - expected.durationSeconds) <= 2;
  checks.push({ name: 'duration', passed: durationMatches, detail: `${metadata.durationSeconds.toFixed(2)} seconds` });
  const aspectRatio = metadata.width / metadata.height;
  const validFrame = metadata.height === expected.height && Math.abs(aspectRatio - 9 / 16) < 0.02;
  checks.push({ name: 'vertical_frame', passed: validFrame, detail: `${metadata.width}×${metadata.height}` });
  const audioPasses = !expected.expectsAudio || metadata.hasAudio;
  checks.push({ name: 'audio', passed: audioPasses, detail: metadata.hasAudio ? 'Audio stream detected.' : 'No audio stream detected.' });
  const subtitlesPass = !expected.subtitlesEnabled || Boolean(expected.subtitlePath);
  checks.push({ name: 'subtitles', passed: subtitlesPass, detail: expected.subtitlesEnabled ? (expected.subtitlePath ? 'Subtitle file generated.' : 'Subtitle file was not generated.') : 'Subtitles were disabled.' });
  const sampleSeconds = Math.max(1, Math.min(10, metadata.durationSeconds));
  const blackSeconds = await blackDurationInSample(path, sampleSeconds, env);
  const nonBlack = blackSeconds < sampleSeconds * 0.95;
  checks.push({ name: 'black_frame_scan', passed: nonBlack, detail: `${blackSeconds.toFixed(2)} black seconds in a ${sampleSeconds.toFixed(2)} second sample` });
  if (checks.some((check) => !check.passed)) throw new AppError(422, 'QUALITY_CHECK_FAILED', 'The rendered clip did not pass output validation.', checks);
  return checks;
};
