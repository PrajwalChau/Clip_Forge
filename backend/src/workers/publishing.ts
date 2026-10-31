import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Queue, Worker } from 'bullmq';
import type { Env } from '../config/env.js';
import { ClipModel } from '../models/Clip.js';
import { ScheduledPostModel } from '../models/ScheduledPost.js';
import { VideoAssetModel } from '../models/VideoAsset.js';
import { makeJobTempDirectory } from '../services/media.js';
import { publishClipToPlatform } from '../services/social/publisher.js';
import type { StorageService } from '../services/storage.js';
import { AppError } from '../utils/errors.js';

type PublishingQueuePayload = { scheduledPostId: string };

export const processScheduledPost = async (
  scheduledPostId: string,
  env: Env,
  storage: StorageService
): Promise<void> => {
  const post = await ScheduledPostModel.findOne({
    _id: scheduledPostId,
    status: { $in: ['scheduled', 'failed'] }
  });

  if (!post) return;

  post.status = 'publishing';
  post.attempts += 1;
  await post.save();

  const clip = await ClipModel.findById(post.clipId);
  if (!clip || !clip.assetId) {
    post.status = 'failed';
    post.failureReason = 'The referenced clip or rendered video is missing.';
    await post.save();
    return;
  }

  const asset = await VideoAssetModel.findById(clip.assetId);
  if (!asset || asset.state !== 'ready') {
    post.status = 'failed';
    post.failureReason = 'The clip video asset is not ready for distribution.';
    await post.save();
    return;
  }

  const tempDir = await makeJobTempDirectory(`publish_${post.id}`);
  const localVideoPath = join(tempDir, 'clip.mp4');

  try {
    // Copy the rendered clip to local temporary directory
    await storage.copyToPath(asset.objectKey, localVideoPath);

    const mediaMeta = {
      durationSeconds: clip.output?.durationSeconds || asset.durationSeconds || 15,
      width: clip.output?.width || asset.width,
      height: clip.output?.height || asset.height
    };

    const result = await publishClipToPlatform(
      String(post.socialAccountId),
      String(post.ownerId),
      localVideoPath,
      mediaMeta,
      {
        title: clip.title,
        caption: post.caption || clip.suggestedCaption || clip.title,
        tags: post.tags,
        privacy: post.privacy as 'public' | 'unlisted' | 'private'
      },
      env
    );

    post.status = 'published';
    post.publishedAt = result.publishedAt;
    post.platformPostId = result.platformPostId;
    post.platformPostUrl = result.platformPostUrl;
    post.failureReason = undefined;
    await post.save();
  } catch (error) {
    const errMessage = error instanceof AppError
      ? error.message
      : (error instanceof Error ? error.message : 'Unknown publishing error');

    if (post.attempts >= post.maxAttempts) {
      post.status = 'failed';
      post.failureReason = errMessage;
    } else {
      post.status = 'failed'; // Mark failed with retry available
      post.failureReason = `${errMessage} (Attempt ${post.attempts}/${post.maxAttempts})`;
    }
    await post.save();
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

export class PublishingDispatcher {
  private queue?: Queue<PublishingQueuePayload>;
  private worker?: Worker<PublishingQueuePayload>;
  private sweeperInterval?: NodeJS.Timeout;

  constructor(private readonly env: Env, private readonly storage: StorageService) {}

  async start(consumeJobs = this.env.WORKER_MODE === 'embedded'): Promise<void> {
    if (this.env.QUEUE_MODE === 'bullmq' && this.env.REDIS_URL) {
      const connection = { url: this.env.REDIS_URL };
      this.queue = new Queue<PublishingQueuePayload>('clipforge-publishing', { connection });

      if (consumeJobs) {
        this.worker = new Worker<PublishingQueuePayload>(
          'clipforge-publishing',
          async (job) => {
            await processScheduledPost(job.data.scheduledPostId, this.env, this.storage);
          },
          { connection, concurrency: 1 }
        );
      }
    }

    // Start background sweeper to recover any due posts
    this.sweeperInterval = setInterval(() => {
      void this.sweepDuePosts().catch(() => undefined);
    }, 60_000);

    // Initial sweep
    void this.sweepDuePosts().catch(() => undefined);
  }

  async schedulePost(scheduledPostId: string, scheduledFor: Date): Promise<void> {
    const delay = Math.max(0, scheduledFor.getTime() - Date.now());

    if (this.env.QUEUE_MODE === 'inline' || !this.queue) {
      if (delay <= 0) {
        queueMicrotask(() => {
          void processScheduledPost(scheduledPostId, this.env, this.storage).catch(() => undefined);
        });
      } else {
        setTimeout(() => {
          void processScheduledPost(scheduledPostId, this.env, this.storage).catch(() => undefined);
        }, Math.min(delay, 2_147_483_647));
      }
      return;
    }

    const job = await this.queue.add(
      'publish-clip',
      { scheduledPostId },
      {
        jobId: `publish_${scheduledPostId}`,
        delay,
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 200,
        removeOnFail: 500
      }
    );

    await ScheduledPostModel.updateOne({ _id: scheduledPostId }, { $set: { jobId: job.id } });
  }

  async cancelScheduledJob(jobId?: string): Promise<void> {
    if (!jobId || !this.queue) return;
    try {
      const job = await this.queue.getJob(jobId);
      if (job) await job.remove();
    } catch {
      // Ignore if job already gone
    }
  }

  /**
   * Periodically checks for overdue scheduled posts and executes them
   */
  async sweepDuePosts(): Promise<void> {
    const now = new Date();
    const duePosts = await ScheduledPostModel.find({
      status: 'scheduled',
      scheduledFor: { $lte: now }
    }).limit(10).lean();

    for (const post of duePosts) {
      await this.schedulePost(String(post._id), new Date());
    }
  }

  async close(): Promise<void> {
    if (this.sweeperInterval) clearInterval(this.sweeperInterval);
    await Promise.all([this.worker?.close(), this.queue?.close()]);
  }
}
