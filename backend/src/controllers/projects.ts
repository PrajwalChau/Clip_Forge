import type { Request, Response } from 'express';
import { z } from 'zod';
import { authUserId } from '../middleware/auth.js';
import { ClipModel } from '../models/Clip.js';
import { ProcessingJobModel } from '../models/ProcessingJob.js';
import { ProjectModel } from '../models/Project.js';
import { UserModel } from '../models/User.js';
import { VideoAssetModel } from '../models/VideoAsset.js';
import { reserveProcessing } from '../services/quota.js';
import type { ProcessingDispatcher } from '../workers/processing.js';
import { AppError } from '../utils/errors.js';

export const createProjectSchema = z.object({
  title: z.string().trim().min(1).max(160),
  settings: z.object({
    targetDurationSeconds: z.number().int().min(15).max(180).optional(),
    requestedClipCount: z.number().int().min(1).max(10).optional(),
    subtitles: z.boolean().optional(),
    editingStyle: z.enum(['clipforge', 'full_video_active_speaker']).optional()
  }).optional(),
  sourceType: z.enum(['upload', 'youtube']).optional(),
  youtubeUrl: z.string().url().max(2048).optional(),
  youtubeVideoId: z.string().max(32).optional(),
  youtubeMetadata: z.object({
    title: z.string().max(255).optional(),
    authorName: z.string().max(255).optional(),
    thumbnailUrl: z.string().max(2048).optional(),
    durationSeconds: z.number().min(0).optional()
  }).optional()
});

export const listProjects = async (req: Request, res: Response): Promise<void> => {
  const ownerId = authUserId(req);
  const projects = await ProjectModel.find({ ownerId }).sort({ updatedAt: -1 }).lean();
  const projectIds = projects.map((project) => project._id);
  const clips = await ClipModel.aggregate<{ _id: unknown; count: number }>([{ $match: { ownerId: new (await import('mongoose')).Types.ObjectId(ownerId), projectId: { $in: projectIds }, state: { $ne: 'deleted' } } }, { $group: { _id: '$projectId', count: { $sum: 1 } } }]);
  const clipCounts = new Map(clips.map((item) => [String(item._id), item.count]));
  res.json({ projects: projects.map((project) => ({ ...project, id: String(project._id), clipCount: clipCounts.get(String(project._id)) ?? 0 })) });
};

export const createProject = async (req: Request, res: Response): Promise<void> => {
  const input = createProjectSchema.parse(req.body);
  const project = await ProjectModel.create({
    ownerId: authUserId(req),
    title: input.title,
    settings: input.settings,
    sourceType: input.sourceType ?? 'upload',
    youtubeUrl: input.youtubeUrl,
    youtubeVideoId: input.youtubeVideoId,
    youtubeMetadata: input.youtubeMetadata
  });
  res.status(201).json({ project });
};

export const getProject = async (req: Request, res: Response): Promise<void> => {
  const project = await ProjectModel.findOne({ _id: req.params.projectId, ownerId: authUserId(req) }).lean();
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'This project was not found.');
  const [asset, activeJob, clips] = await Promise.all([
    project.sourceAssetId ? VideoAssetModel.findOne({ _id: project.sourceAssetId, ownerId: project.ownerId }).lean() : null,
    ProcessingJobModel.findOne({ projectId: project._id, ownerId: project.ownerId }).sort({ createdAt: -1 }).lean(),
    ClipModel.find({ projectId: project._id, ownerId: project.ownerId, state: { $ne: 'deleted' } }).sort({ createdAt: -1 }).lean()
  ]);
  res.json({ project, sourceAsset: asset, job: activeJob, clips });
};

export const startProcessing = (dispatcher: ProcessingDispatcher) => async (req: Request, res: Response): Promise<void> => {
  const ownerId = authUserId(req);
  const project = await ProjectModel.findOne({ _id: req.params.projectId, ownerId });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'This project was not found.');
  if (!project.sourceAssetId) throw new AppError(409, 'SOURCE_REQUIRED', 'Upload an MP4 source video before starting processing.');
  const source = await VideoAssetModel.findOne({ _id: project.sourceAssetId, ownerId, state: 'uploaded' });
  if (!source?.durationSeconds) throw new AppError(409, 'SOURCE_NOT_READY', 'The source video has not finished validation.');
  const user = await UserModel.findById(ownerId);
  if (!user) throw new AppError(401, 'SESSION_INVALID', 'Your session has expired. Please sign in again.');
  const settings = project.settings ?? { requestedClipCount: 3 };
  const duplicate = await ProcessingJobModel.exists({ projectId: project.id, status: { $in: ['queued', 'processing'] } });
  if (duplicate) throw new AppError(409, 'PROCESSING_IN_PROGRESS', 'This project is already processing.');
  await reserveProcessing(ownerId, user.plan, Math.ceil(source.durationSeconds), settings.requestedClipCount, user.role);
  try {
    const job = await ProcessingJobModel.create({ ownerId, projectId: project.id, sourceAssetId: source.id });
    project.status = 'queued';
    await project.save();
    await dispatcher.enqueue(job.id);
    res.status(202).json({ job });
  } catch (error) {
    const { releaseProcessingReservation } = await import('../services/quota.js');
    await releaseProcessingReservation(ownerId, Math.ceil(source.durationSeconds), settings.requestedClipCount);
    throw error;
  }
};

export const cancelProcessing = async (req: Request, res: Response): Promise<void> => {
  const ownerId = authUserId(req);
  const job = await ProcessingJobModel.findOne({ _id: req.params.jobId, ownerId, status: { $in: ['queued', 'processing'] } });
  if (!job) throw new AppError(409, 'JOB_CANNOT_CANCEL', 'This job is already complete, failed, or cancelled.');
  if (job.status === 'processing') {
    const requested = await ProcessingJobModel.findOneAndUpdate({ _id: job.id, ownerId, status: 'processing', cancellationRequestedAt: { $exists: false } }, { $set: { cancellationRequestedAt: new Date() } }, { new: true });
    if (!requested) throw new AppError(409, 'JOB_CANNOT_CANCEL', 'Cancellation has already been requested for this job.');
    res.status(202).json({ job: requested, message: 'Cancellation requested. The active worker will stop and clean up shortly.' });
    return;
  }
  const cancelled = await ProcessingJobModel.findOneAndUpdate({ _id: job.id, ownerId, status: 'queued' }, { $set: { status: 'cancelled', cancelledAt: new Date() } }, { new: true });
  if (!cancelled) throw new AppError(409, 'JOB_CANNOT_CANCEL', 'The job began processing before it could be cancelled. Try cancelling it again.');
  await ProjectModel.updateOne({ _id: cancelled.projectId }, { $set: { status: 'cancelled' } });
  const source = await VideoAssetModel.findById(cancelled.sourceAssetId);
  if (source?.durationSeconds) {
    const project = await ProjectModel.findById(cancelled.projectId);
    if (project) {
      const { releaseProcessingReservation } = await import('../services/quota.js');
      await releaseProcessingReservation(cancelled.ownerId, Math.ceil(source.durationSeconds), project.settings?.requestedClipCount ?? 3);
    }
  }
  res.status(204).send();
};
