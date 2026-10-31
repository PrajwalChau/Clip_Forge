import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { inspectYouTubeVideo } from '../services/youtube.js';

const inspectSchema = z.object({
  url: z.string().trim().min(1, 'YouTube URL is required')
});

const analyzeSchema = z.object({
  url: z.string().trim().min(1, 'YouTube URL is required'),
  targetDurationSeconds: z.number().int().min(15).max(180).default(15),
  clipCount: z.number().int().min(1).max(10).default(3)
});

export const inspect = (env: Env) => async (req: Request, res: Response): Promise<void> => {
  const { url } = inspectSchema.parse(req.body);
  const result = await inspectYouTubeVideo(url, env);
  res.json(result);
};

export const analyzeTranscript = (env: Env) => async (req: Request, res: Response): Promise<void> => {
  const input = analyzeSchema.parse(req.body);
  const inspection = await inspectYouTubeVideo(input.url, env);

  if (!inspection.transcript.available || inspection.transcript.segments.length === 0) {
    res.json({
      inspection,
      suggestions: [],
      message: inspection.transcript.reason || 'No public transcript was available for analysis.'
    });
    return;
  }

  const { selectClips } = await import('../services/providers.js');
  const estimatedDuration = inspection.metadata.durationSeconds
    || (inspection.transcript.segments.length > 0
      ? Math.ceil(inspection.transcript.segments[inspection.transcript.segments.length - 1]!.endSeconds)
      : 300);

  const suggestions = await selectClips(
    inspection.transcript.segments,
    estimatedDuration,
    input.clipCount,
    env,
    undefined,
    input.targetDurationSeconds
  );

  res.json({
    inspection,
    suggestions,
    estimatedDuration
  });
};
