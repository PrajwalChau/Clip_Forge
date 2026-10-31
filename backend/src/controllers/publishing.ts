import type { Request, Response } from 'express';
import { z } from 'zod';
import { authUserId } from '../middleware/auth.js';
import { ClipModel } from '../models/Clip.js';
import { ScheduledPostModel } from '../models/ScheduledPost.js';
import { SocialAccountModel } from '../models/SocialAccount.js';
import { verifyMediaForPlatform } from '../services/social/publisher.js';
import type { SocialPlatform } from '../services/social/types.js';
import type { PublishingDispatcher } from '../workers/publishing.js';
import { AppError } from '../utils/errors.js';

const scheduleSchema = z.object({
  clipId: z.string().min(1, 'Clip ID is required'),
  socialAccountId: z.string().min(1, 'Social account ID is required'),
  caption: z.string().trim().max(2200).default(''),
  tags: z.array(z.string().trim().max(100)).max(30).optional().default([]),
  privacy: z.enum(['public', 'unlisted', 'private']).default('public'),
  scheduledFor: z.string().datetime({ offset: true }).or(z.string().datetime()).optional(),
  timezone: z.string().max(100).default('UTC'),
  publishNow: z.boolean().default(false)
});

const verifyMediaSchema = z.object({
  clipId: z.string().min(1),
  platform: z.enum(['youtube', 'tiktok', 'instagram', 'facebook'])
});

export const listPosts = async (req: Request, res: Response): Promise<void> => {
  const ownerId = authUserId(req);
  const { clipId, status, platform } = req.query;

  const filter: Record<string, unknown> = { ownerId };
  if (clipId) filter.clipId = clipId;
  if (status) filter.status = status;
  if (platform) filter.platform = platform;

  const posts = await ScheduledPostModel.find(filter)
    .populate('socialAccountId', 'platform accountName accountHandle avatarUrl')
    .populate('clipId', 'title summary score startSeconds endSeconds output')
    .sort({ scheduledFor: -1 })
    .lean();

  res.json({ posts });
};

export const schedulePost = (dispatcher: PublishingDispatcher) => async (req: Request, res: Response): Promise<void> => {
  const ownerId = authUserId(req);
  const input = scheduleSchema.parse(req.body);

  const [clip, account] = await Promise.all([
    ClipModel.findOne({ _id: input.clipId, ownerId, state: 'ready' }),
    SocialAccountModel.findOne({ _id: input.socialAccountId, ownerId, status: { $ne: 'disconnected' } })
  ]);

  if (!clip) {
    throw new AppError(404, 'CLIP_NOT_FOUND', 'This clip was not found or is not yet ready for publishing.');
  }

  if (!account) {
    throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'The chosen social account is not connected or active.');
  }

  // Pre-validate clip media meets platform specs
  const duration = clip.output?.durationSeconds || (clip.endSeconds - clip.startSeconds);
  const verification = verifyMediaForPlatform(account.platform as SocialPlatform, {
    durationSeconds: duration,
    width: clip.output?.width,
    height: clip.output?.height
  });

  if (!verification.valid) {
    throw new AppError(422, 'MEDIA_SPEC_FAILED', verification.errors.join(' '));
  }

  // Determine schedule date (now vs future)
  const scheduledDate = input.publishNow || !input.scheduledFor
    ? new Date()
    : new Date(input.scheduledFor);

  const post = await ScheduledPostModel.create({
    ownerId,
    clipId: clip.id,
    socialAccountId: account.id,
    platform: account.platform,
    caption: input.caption || clip.suggestedCaption || clip.title,
    tags: input.tags,
    privacy: input.privacy,
    scheduledFor: scheduledDate,
    timezone: input.timezone,
    status: 'scheduled'
  });

  await dispatcher.schedulePost(post.id, scheduledDate);

  res.status(201).json({
    post,
    message: input.publishNow
      ? 'Post submitted to publishing queue for immediate processing.'
      : `Post scheduled for ${scheduledDate.toISOString()}.`
  });
};

export const cancelPost = (dispatcher: PublishingDispatcher) => async (req: Request, res: Response): Promise<void> => {
  const ownerId = authUserId(req);
  const { postId } = req.params;

  const post = await ScheduledPostModel.findOne({
    _id: postId,
    ownerId,
    status: 'scheduled'
  });

  if (!post) {
    throw new AppError(409, 'CANNOT_CANCEL', 'Only scheduled posts that have not yet begun publishing can be cancelled.');
  }

  post.status = 'cancelled';
  await post.save();

  if (post.jobId) {
    await dispatcher.cancelScheduledJob(post.jobId);
  }

  res.json({ success: true, message: 'Scheduled post cancelled.' });
};

export const retryPost = (dispatcher: PublishingDispatcher) => async (req: Request, res: Response): Promise<void> => {
  const ownerId = authUserId(req);
  const { postId } = req.params;

  const post = await ScheduledPostModel.findOne({
    _id: postId,
    ownerId,
    status: 'failed'
  });

  if (!post) {
    throw new AppError(404, 'POST_NOT_FOUND', 'Failed post not found or not eligible for retry.');
  }

  post.status = 'scheduled';
  post.attempts = 0;
  post.failureReason = undefined;
  await post.save();

  await dispatcher.schedulePost(post.id, new Date());

  res.json({ success: true, message: 'Post re-queued for publishing.', post });
};

export const verifyMedia = async (req: Request, res: Response): Promise<void> => {
  const ownerId = authUserId(req);
  const { clipId, platform } = verifyMediaSchema.parse(req.body);

  const clip = await ClipModel.findOne({ _id: clipId, ownerId });
  if (!clip) {
    throw new AppError(404, 'CLIP_NOT_FOUND', 'Clip not found.');
  }

  const duration = clip.output?.durationSeconds || (clip.endSeconds - clip.startSeconds);
  const result = verifyMediaForPlatform(platform as SocialPlatform, {
    durationSeconds: duration,
    width: clip.output?.width,
    height: clip.output?.height
  });

  res.json(result);
};
