import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { Queue, Worker } from 'bullmq';
import type { Env } from '../config/env.js';
import { ClipModel } from '../models/Clip.js';
import { ProcessingJobModel } from '../models/ProcessingJob.js';
import { ProjectModel } from '../models/Project.js';
import { VideoAssetModel } from '../models/VideoAsset.js';
import { UserModel } from '../models/User.js';
import { cleanupStaleJobTempDirectories, makeJobTempDirectory, probeVideo, removeJobTempDirectory, renderFullVideoActiveSpeakerClip, renderVerticalClip, verifyRenderedClip, writeClipSubtitles } from '../services/media.js';
import { getPlan } from '../services/plans.js';
import { selectClips, transcribe } from '../services/providers.js';
import { commitStorage, completeReservedProcessing, deleteStoredBytes, releaseProcessingReservation, releaseStorageReservation, reserveStorage } from '../services/quota.js';
import type { StorageService } from '../services/storage.js';
import { newObjectKey } from '../utils/ids.js';
import { AppError } from '../utils/errors.js';
import { TranscriptModel } from '../models/Transcript.js';

type QueuePayload = { processingJobId: string };

const ensureNotCancelled = async (jobId: string): Promise<void> => {
  const job = await ProcessingJobModel.findById(jobId).lean();
  if (!job || job.status === 'cancelled' || job.cancellationRequestedAt) throw new AppError(409, 'JOB_CANCELLED', 'This processing job was cancelled.');
};

const watchForCancellation = (jobId: string, controller: AbortController): (() => void) => {
  let checking = false;
  const check = async (): Promise<void> => {
    if (checking || controller.signal.aborted) return;
    checking = true;
    try {
      const job = await ProcessingJobModel.findById(jobId).select('status cancellationRequestedAt').lean();
      if (!job || job.status === 'cancelled' || job.cancellationRequestedAt) controller.abort();
    } finally { checking = false; }
  };
  const timer = setInterval(() => { void check(); }, 1_000);
  void check();
  return () => clearInterval(timer);
};

const recoverRequestedCancellation = async (processingJobId: string, storage: StorageService): Promise<void> => {
  const processingJob = await ProcessingJobModel.findOne({ _id: processingJobId, status: 'processing', cancellationRequestedAt: { $exists: true } }).lean();
  if (!processingJob) return;

  const [project, source, clips] = await Promise.all([
    ProjectModel.findById(processingJob.projectId).lean(),
    VideoAssetModel.findById(processingJob.sourceAssetId).lean(),
    ClipModel.find({ jobId: processingJob._id, state: { $ne: 'deleted' } }).select('_id assetId').lean()
  ]);
  const outputAssetIds = clips.flatMap((clip) => clip.assetId ? [clip.assetId] : []);
  const outputAssets = outputAssetIds.length > 0 ? await VideoAssetModel.find({ _id: { $in: outputAssetIds }, state: { $ne: 'deleted' } }).lean() : [];

  await Promise.all(outputAssets.map(async (asset) => {
    await storage.delete(asset.objectKey).catch(() => undefined);
    const removed = await VideoAssetModel.updateOne({ _id: asset._id, state: { $ne: 'deleted' } }, { $set: { state: 'deleted', deletedAt: new Date() } });
    if (removed.modifiedCount === 1) await deleteStoredBytes(processingJob.ownerId, asset.sizeBytes);
  }));
  if (clips.length > 0) await ClipModel.updateMany({ _id: { $in: clips.map((clip) => clip._id) }, state: { $ne: 'deleted' } }, { $set: { state: 'deleted', deletedAt: new Date() } });

  if (source?.durationSeconds) await releaseProcessingReservation(processingJob.ownerId, Math.ceil(source.durationSeconds), project?.settings?.requestedClipCount ?? 3);
  await Promise.all([
    VideoAssetModel.updateOne({ _id: processingJob.sourceAssetId, state: 'processing' }, { $set: { state: 'uploaded' } }),
    ProjectModel.updateOne({ _id: processingJob.projectId }, { $set: { status: 'cancelled' }, $unset: { failureCode: 1, failureMessage: 1 } }),
    ProcessingJobModel.updateOne({ _id: processingJob._id, status: 'processing', cancellationRequestedAt: { $exists: true } }, { $set: { status: 'cancelled', errorCode: 'JOB_CANCELLED', errorMessage: 'Processing was cancelled.', cancelledAt: new Date(), completedAt: new Date() } })
  ]);
};

const processVideo = async (processingJobId: string, env: Env, storage: StorageService, attemptNumber = 1, maxAttempts = 1): Promise<void> => {
  const processingJob = await ProcessingJobModel.findOneAndUpdate({ _id: processingJobId, status: 'queued' }, { $set: { status: 'processing', step: 'validating', progress: 5, startedAt: new Date() }, $inc: { attempts: 1 } }, { new: true });
  if (!processingJob) return;
  const project = await ProjectModel.findOne({ _id: processingJob.projectId, ownerId: processingJob.ownerId });
  const source = await VideoAssetModel.findOne({ _id: processingJob.sourceAssetId, ownerId: processingJob.ownerId, state: 'uploaded' });
  const user = await UserModel.findById(processingJob.ownerId);
  if (!project || !source || !user) {
    await Promise.all([
      ProcessingJobModel.updateOne({ _id: processingJob.id }, { $set: { status: 'failed', errorCode: 'PROCESSING_INPUT_MISSING', errorMessage: 'The source project or video is no longer available.', completedAt: new Date() } }),
      ProjectModel.updateOne({ _id: processingJob.projectId }, { $set: { status: 'failed', failureCode: 'PROCESSING_INPUT_MISSING', failureMessage: 'The source project or video is no longer available.' } })
    ]);
    return;
  }
  const tempDir = await makeJobTempDirectory(processingJob.id);
  const reservationSeconds = source.durationSeconds ?? 0;
  const reservationClips = project.settings?.requestedClipCount ?? 3;
  const createdOutputAssets: Array<{ id: string; objectKey: string; sizeBytes: number }> = [];
  const createdClipIds: string[] = [];
  const cancellation = new AbortController();
  const stopCancellationWatch = watchForCancellation(processingJob.id, cancellation);
  try {
    const localInput = join(tempDir, 'source.mp4');
    await storage.copyToPath(source.objectKey, localInput);
    await ensureNotCancelled(processingJob.id);
    const metadata = await probeVideo(localInput, env);
    if (Math.abs(metadata.durationSeconds - reservationSeconds) > 2) throw new AppError(422, 'SOURCE_CHANGED', 'The uploaded video duration changed after it was reserved. Please upload it again.');
    await ProcessingJobModel.updateOne({ _id: processingJob.id, status: 'processing' }, { $set: { step: 'transcribing', progress: 15 } });
    await VideoAssetModel.updateOne({ _id: source.id }, { $set: { state: 'processing' } });
    const transcription = await transcribe(localInput, metadata.durationSeconds, env, cancellation.signal);
    const transcript = transcription.segments;
    const transcriptRecord = await TranscriptModel.findOneAndUpdate(
      { processingJobId: processingJob.id },
      { $set: { ownerId: processingJob.ownerId, projectId: project.id, processingJobId: processingJob.id, provider: transcription.provider, isDemo: transcription.isDemo, language: transcription.language, text: transcript.map((segment) => segment.text).join(' '), segments: transcript } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await ensureNotCancelled(processingJob.id);
    await ProcessingJobModel.updateOne({ _id: processingJob.id, status: 'processing' }, { $set: { transcriptId: transcriptRecord._id, step: 'analyzing', progress: 40 } });
    const targetDuration = project.settings?.targetDurationSeconds ?? 15;
    const selections = await selectClips(transcript, metadata.durationSeconds, Math.min(reservationClips, env.MAX_CLIPS_PER_JOB), env, cancellation.signal, targetDuration);
    if (selections.length === 0) throw new AppError(422, 'CLIP_SELECTION_EMPTY', 'No valid clip windows were selected from the transcript.');
    await ensureNotCancelled(processingJob.id);
    const editingStyle = project.settings?.editingStyle ?? 'clipforge';
    await ProcessingJobModel.updateOne({ _id: processingJob.id, status: 'processing' }, { $set: { selectionMode: selections[0]?.mode, step: 'rendering', progress: 55, processingConfig: { subtitles: project.settings?.subtitles ?? true, requestedClipCount: reservationClips, targetDurationSeconds: targetDuration, aspectRatio: project.settings?.aspectRatio ?? '9:16', editingStyle } } });
    const plan = getPlan(user.plan);
    let rendered = 0;
    for (const [index, selection] of selections.entries()) {
      await ensureNotCancelled(processingJob.id);
      const clipDuration = Math.min(metadata.durationSeconds, targetDuration);
      const startSeconds = Math.max(0, Math.min(selection.startSeconds, metadata.durationSeconds - clipDuration));
      const endSeconds = startSeconds + clipDuration;
      const subtitlePath = project.settings?.subtitles ? await writeClipSubtitles(tempDir, startSeconds, endSeconds, transcript) : undefined;
      if (project.settings?.subtitles && !subtitlePath) throw new AppError(422, 'SUBTITLE_GENERATION_FAILED', 'Subtitles were requested but no usable subtitle cues were generated.');
      const localOutput = editingStyle === 'full_video_active_speaker'
        ? await renderFullVideoActiveSpeakerClip(localInput, tempDir, startSeconds, endSeconds, plan.outputHeight, plan.watermark, subtitlePath, env, cancellation.signal)
        : await renderVerticalClip(localInput, tempDir, startSeconds, endSeconds, plan.outputHeight, plan.watermark, subtitlePath, env, cancellation.signal);
      const renderedSize = (await stat(localOutput)).size;
      await ProcessingJobModel.updateOne({ _id: processingJob.id, status: 'processing' }, { $set: { step: 'quality_check', progress: Math.min(94, 55 + Math.round((index / selections.length) * 35)) } });
      const qualityChecks = await verifyRenderedClip(localOutput, { durationSeconds: endSeconds - startSeconds, height: plan.outputHeight, expectsAudio: metadata.hasAudio, subtitlesEnabled: project.settings?.subtitles ?? true, subtitlePath }, env);
      await reserveStorage(processingJob.ownerId, user.plan, renderedSize);
      const objectKey = newObjectKey(String(processingJob.ownerId), 'rendered', 'mp4');
      let stored;
      try { await ProcessingJobModel.updateOne({ _id: processingJob.id, status: 'processing' }, { $set: { step: 'uploading', progress: Math.min(95, 60 + Math.round((index / selections.length) * 35)) } }); stored = await storage.putFromPath(objectKey, localOutput); await commitStorage(processingJob.ownerId, stored.sizeBytes); } catch (error) { await releaseStorageReservation(processingJob.ownerId, renderedSize); throw error; }
      const expiresAt = new Date(Date.now() + plan.retentionDays * 24 * 60 * 60 * 1000);
      const outputWidth = Math.floor((plan.outputHeight * 9 / 16) / 2) * 2;
      const asset = await VideoAssetModel.create({ ownerId: processingJob.ownerId, projectId: project.id, kind: 'rendered', originalFilename: `${project.title}-${index + 1}.mp4`, mimeType: 'video/mp4', sizeBytes: stored.sizeBytes, durationSeconds: endSeconds - startSeconds, width: outputWidth, height: plan.outputHeight, storageProvider: env.STORAGE_PROVIDER, objectKey, state: 'ready', expiresAt });
      createdOutputAssets.push({ id: asset.id, objectKey: asset.objectKey, sizeBytes: asset.sizeBytes });
      const clip = await ClipModel.create({ ownerId: processingJob.ownerId, projectId: project.id, jobId: processingJob.id, assetId: asset.id, startSeconds, endSeconds, title: selection.title, summary: selection.summary, selectionReason: selection.selectionReason, score: Math.min(100, Math.max(0, selection.score)), selectionMode: selection.mode, suggestedCaption: selection.suggestedCaption, topic: selection.topic, state: 'ready', output: { width: outputWidth, height: plan.outputHeight, durationSeconds: endSeconds - startSeconds, hasWatermark: plan.watermark }, quality: { status: 'passed', checks: qualityChecks, checkedAt: new Date() }, expiresAt });
      createdClipIds.push(clip.id);
      rendered += 1;
      await ProcessingJobModel.updateOne({ _id: processingJob.id, status: 'processing' }, { $set: { progress: Math.min(95, 55 + Math.round(((index + 1) / selections.length) * 40)) } });
    }
    await ensureNotCancelled(processingJob.id);
    await completeReservedProcessing(processingJob.ownerId, reservationSeconds, reservationClips, rendered);
    await Promise.all([
      VideoAssetModel.updateOne({ _id: source.id }, { $set: { state: 'ready' } }),
      ProjectModel.updateOne({ _id: project.id }, { $set: { status: 'completed' }, $unset: { failureCode: 1, failureMessage: 1 } }),
      ProcessingJobModel.updateOne({ _id: processingJob.id }, { $set: { status: 'completed', step: 'finalizing', progress: 100, completedAt: new Date() } })
    ]);
  } catch (error) {
    const appError = error instanceof AppError ? error : new AppError(500, 'PROCESSING_FAILED', 'Video processing could not be completed.');
    const cancelled = appError.code === 'JOB_CANCELLED';
    const retrying = !cancelled && attemptNumber < maxAttempts;
    if (!retrying) {
      await Promise.all(createdOutputAssets.map(async (asset) => { await storage.delete(asset.objectKey).catch(() => undefined); await VideoAssetModel.updateOne({ _id: asset.id }, { $set: { state: 'deleted', deletedAt: new Date() } }); await deleteStoredBytes(processingJob.ownerId, asset.sizeBytes); }));
      await ClipModel.updateMany({ _id: { $in: createdClipIds }, state: 'ready' }, { $set: { state: 'deleted', deletedAt: new Date() } });
    }
    if (!retrying) await releaseProcessingReservation(processingJob.ownerId, reservationSeconds, reservationClips);
    await Promise.all([
      VideoAssetModel.updateOne({ _id: source.id }, { $set: { state: 'uploaded' } }),
      ProjectModel.updateOne({ _id: project.id }, { $set: { status: retrying ? 'queued' : (cancelled ? 'cancelled' : 'failed'), failureCode: retrying ? undefined : appError.code, failureMessage: retrying ? undefined : appError.message } }),
      ProcessingJobModel.updateOne({ _id: processingJob.id }, { $set: { status: retrying ? 'queued' : (cancelled ? 'cancelled' : 'failed'), errorCode: retrying ? undefined : appError.code, errorMessage: retrying ? undefined : appError.message, completedAt: retrying ? undefined : new Date(), step: retrying ? 'queued' : processingJob.step, progress: retrying ? 0 : processingJob.progress } })
    ]);
    throw appError;
  } finally {
    stopCancellationWatch();
    await removeJobTempDirectory(tempDir);
  }
};

export class ProcessingDispatcher {
  private queue?: Queue<QueuePayload>;
  private worker?: Worker<QueuePayload>;

  constructor(private readonly env: Env, private readonly storage: StorageService) {}

  async start(consumeJobs = this.env.WORKER_MODE === 'embedded'): Promise<void> {
    if (this.env.QUEUE_MODE !== 'bullmq') return;
    const connection = { url: this.env.REDIS_URL! };
    this.queue = new Queue<QueuePayload>('clipforge-processing', { connection });
    const cancellationRequests = await ProcessingJobModel.find({ status: 'processing', cancellationRequestedAt: { $exists: true } }).select('_id').lean();
    await Promise.all(cancellationRequests.map((job) => recoverRequestedCancellation(String(job._id), this.storage)));
    if (consumeJobs) this.worker = new Worker<QueuePayload>('clipforge-processing', async (job) => processVideo(job.data.processingJobId, this.env, this.storage, job.attemptsMade + 1, job.opts.attempts ?? 1), { connection, concurrency: this.env.WORKER_CONCURRENCY });
  }

  async enqueue(processingJobId: string): Promise<void> {
    if (this.env.QUEUE_MODE === 'inline') {
      queueMicrotask(() => { void processVideo(processingJobId, this.env, this.storage).catch(() => undefined); });
      return;
    }
    if (!this.queue) throw new AppError(503, 'WORKER_UNAVAILABLE', 'The processing queue is unavailable.');
    const queued = await this.queue.add('process-video', { processingJobId }, { jobId: processingJobId, attempts: 3, backoff: { type: 'exponential', delay: 3_000 }, removeOnComplete: 100, removeOnFail: 500 });
    await ProcessingJobModel.updateOne({ _id: processingJobId }, { $set: { queueJobId: queued.id } });
  }

  async getHealth(): Promise<{ mode: 'inline' | 'bullmq'; available: boolean; waiting?: number; active?: number; failed?: number }> {
    if (this.env.QUEUE_MODE === 'inline') return { mode: 'inline', available: true };
    if (!this.queue) return { mode: 'bullmq', available: false };
    try {
      const counts = await this.queue.getJobCounts('waiting', 'active', 'failed');
      return { mode: 'bullmq', available: true, waiting: counts.waiting ?? 0, active: counts.active ?? 0, failed: counts.failed ?? 0 };
    } catch {
      return { mode: 'bullmq', available: false };
    }
  }

  async close(): Promise<void> {
    await Promise.all([this.worker?.close(), this.queue?.close()]);
  }

  async cleanupStaleFiles(): Promise<number> {
    const active = await ProcessingJobModel.find({ status: { $in: ['queued', 'processing'] } }).select('_id').lean();
    return cleanupStaleJobTempDirectories(this.env.TEMP_FILE_MAX_AGE_HOURS, new Set(active.map((job) => String(job._id))));
  }
}
