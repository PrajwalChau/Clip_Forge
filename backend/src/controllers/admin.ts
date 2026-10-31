import type { Request, Response } from 'express';
import mongoose, { Types } from 'mongoose';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { authUserId } from '../middleware/auth.js';
import { writeAuditLog } from '../services/audit.js';
import { PLANS } from '../services/plans.js';
import { reserveProcessing, releaseProcessingReservation } from '../services/quota.js';
import type { ProcessingDispatcher } from '../workers/processing.js';
import { AuditLogModel } from '../models/AuditLog.js';
import { ClipModel } from '../models/Clip.js';
import { PaymentModel } from '../models/Payment.js';
import { ProcessingJobModel } from '../models/ProcessingJob.js';
import { ProjectModel } from '../models/Project.js';
import { SubscriptionModel } from '../models/Subscription.js';
import { UsageModel } from '../models/Usage.js';
import { UserModel } from '../models/User.js';
import { VideoAssetModel } from '../models/VideoAsset.js';
import { AppError } from '../utils/errors.js';

const paginationSchema = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) });
const userQuerySchema = paginationSchema.extend({ search: z.string().trim().max(100).optional(), plan: z.enum(['free', 'pro', 'premium']).optional(), status: z.enum(['active', 'suspended']).optional(), role: z.enum(['user', 'admin']).optional() });
const projectQuerySchema = paginationSchema.extend({ search: z.string().trim().max(100).optional(), status: z.enum(['draft', 'uploaded', 'queued', 'processing', 'completed', 'failed', 'cancelled']).optional() });
const jobQuerySchema = paginationSchema.extend({ status: z.enum(['queued', 'processing', 'completed', 'failed', 'cancelled']).optional() });
const statusSchema = z.object({ status: z.enum(['active', 'suspended']), reason: z.string().trim().min(3).max(500).optional() }).superRefine((value, ctx) => {
  if (value.status === 'suspended' && !value.reason) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'A suspension reason is required.' });
});

const pageResult = (page: number, limit: number, total: number) => ({ page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) });
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const objectId = (id: string): Types.ObjectId => {
  if (!Types.ObjectId.isValid(id)) throw new AppError(400, 'INVALID_ID', 'The requested identifier is invalid.');
  return new Types.ObjectId(id);
};
const requestParam = (req: Request, key: string): string => {
  const value = req.params[key];
  if (typeof value !== 'string') throw new AppError(400, 'INVALID_ID', 'The requested identifier is invalid.');
  return value;
};
const safeUser = (user: { _id: unknown; email: string; name: string; plan: string; role: string; accountStatus: string; createdAt?: Date | null; lastLoginAt?: Date | null }) => ({ id: String(user._id), email: user.email, name: user.name, plan: user.plan, role: user.role, accountStatus: user.accountStatus, createdAt: user.createdAt ?? undefined, lastLoginAt: user.lastLoginAt ?? undefined });

export const overview = async (_req: Request, res: Response): Promise<void> => {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [totalUsers, recentRegistrations, activeSubscriptions, revenue, totalStored, jobStatus, recentEvents] = await Promise.all([
    UserModel.countDocuments(),
    UserModel.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
    SubscriptionModel.countDocuments({ status: 'active', currentPeriodEnd: { $gt: now } }),
    PaymentModel.aggregate<{ total: number }>([{ $match: { status: 'verified', currency: 'NPR' } }, { $group: { _id: null, total: { $sum: '$amountPaisa' } } }]),
    VideoAssetModel.aggregate<{ total: number }>([{ $match: { state: { $ne: 'deleted' } } }, { $group: { _id: null, total: { $sum: '$sizeBytes' } } }]),
    ProcessingJobModel.aggregate<{ _id: string; count: number }>([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    AuditLogModel.find().sort({ createdAt: -1 }).limit(8).populate('actorId', 'name email').lean()
  ]);
  res.json({
    metrics: { totalUsers, recentRegistrations, activeSubscriptions, verifiedRevenuePaisa: revenue[0]?.total ?? 0, totalStoredBytes: totalStored[0]?.total ?? 0 },
    jobs: Object.fromEntries(jobStatus.map((entry) => [entry._id, entry.count])),
    events: recentEvents.map((event) => ({ id: String(event._id), action: event.action, targetType: event.targetType, targetId: event.targetId, outcome: event.outcome, createdAt: event.createdAt, actor: event.actorId && typeof event.actorId === 'object' ? event.actorId : null }))
  });
};

export const listUsers = async (req: Request, res: Response): Promise<void> => {
  const input = userQuerySchema.parse(req.query);
  const filter: Record<string, unknown> = {};
  if (input.search) { const regex = new RegExp(escapeRegex(input.search), 'i'); filter.$or = [{ email: regex }, { name: regex }]; }
  if (input.plan) filter.plan = input.plan;
  if (input.status) filter.accountStatus = input.status;
  if (input.role) filter.role = input.role;
  const [total, users] = await Promise.all([UserModel.countDocuments(filter), UserModel.find(filter).select('email name plan role accountStatus createdAt lastLoginAt').sort({ createdAt: -1 }).skip((input.page - 1) * input.limit).limit(input.limit).lean()]);
  res.json({ users: users.map(safeUser), pagination: pageResult(input.page, input.limit, total) });
};

export const getUser = async (req: Request, res: Response): Promise<void> => {
  const targetId = objectId(requestParam(req, 'userId'));
  const user = await UserModel.findById(targetId).select('email name plan role accountStatus createdAt lastLoginAt suspendedAt suspensionReason').lean();
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'This account was not found.');
  const [projectCount, clipCount, jobStatus, currentUsage, subscriptions] = await Promise.all([
    ProjectModel.countDocuments({ ownerId: targetId }),
    ClipModel.countDocuments({ ownerId: targetId, state: { $ne: 'deleted' } }),
    ProcessingJobModel.aggregate<{ _id: string; count: number }>([{ $match: { ownerId: targetId } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    UsageModel.findOne({ ownerId: targetId }).sort({ createdAt: -1 }).lean(),
    SubscriptionModel.find({ ownerId: targetId }).sort({ createdAt: -1 }).limit(5).lean()
  ]);
  res.json({ user: safeUser(user), summary: { projectCount, clipCount, jobs: Object.fromEntries(jobStatus.map((entry) => [entry._id, entry.count])), usage: currentUsage, subscriptions } });
};

export const updateUserStatus = async (req: Request, res: Response): Promise<void> => {
  const input = statusSchema.parse(req.body);
  const actorId = authUserId(req);
  const targetId = objectId(requestParam(req, 'userId'));
  if (String(targetId) === actorId) throw new AppError(409, 'SELF_STATUS_CHANGE_FORBIDDEN', 'Administrators cannot suspend their own account.');
  const target = await UserModel.findById(targetId).select('+sessionVersion role accountStatus');
  if (!target) throw new AppError(404, 'USER_NOT_FOUND', 'This account was not found.');
  if (target.role === 'admin' && input.status === 'suspended' && target.accountStatus === 'active') {
    const activeAdmins = await UserModel.countDocuments({ role: 'admin', accountStatus: 'active' });
    if (activeAdmins <= 1) throw new AppError(409, 'LAST_ADMIN_PROTECTED', 'The last active administrator cannot be suspended.');
  }
  target.accountStatus = input.status;
  target.suspendedAt = input.status === 'suspended' ? new Date() : undefined;
  target.suspensionReason = input.status === 'suspended' ? input.reason : undefined;
  target.sessionVersion += 1;
  await target.save();
  await writeAuditLog({ actorId, action: input.status === 'suspended' ? 'user.suspend' : 'user.reactivate', targetType: 'user', targetId: target.id, reason: input.reason, metadata: { role: target.role } });
  res.json({ user: safeUser(target) });
};

export const listProjects = async (req: Request, res: Response): Promise<void> => {
  const input = projectQuerySchema.parse(req.query);
  const filter: Record<string, unknown> = {};
  if (input.search) filter.title = new RegExp(escapeRegex(input.search), 'i');
  if (input.status) filter.status = input.status;
  const [total, projects] = await Promise.all([ProjectModel.countDocuments(filter), ProjectModel.find(filter).select('ownerId title status sourceAssetId settings createdAt updatedAt failureCode').populate('ownerId', 'name email plan accountStatus').sort({ updatedAt: -1 }).skip((input.page - 1) * input.limit).limit(input.limit).lean()]);
  res.json({ projects: projects.map((project) => ({ ...project, id: String(project._id), owner: project.ownerId })), pagination: pageResult(input.page, input.limit, total) });
};

export const listJobs = async (req: Request, res: Response): Promise<void> => {
  const input = jobQuerySchema.parse(req.query);
  const filter = input.status ? { status: input.status } : {};
  const [total, jobs] = await Promise.all([ProcessingJobModel.countDocuments(filter), ProcessingJobModel.find(filter).select('ownerId projectId sourceAssetId status step progress attempts errorCode createdAt updatedAt completedAt').populate('ownerId', 'name email').populate('projectId', 'title status').sort({ updatedAt: -1 }).skip((input.page - 1) * input.limit).limit(input.limit).lean()]);
  res.json({ jobs: jobs.map((job) => ({ ...job, id: String(job._id) })), pagination: pageResult(input.page, input.limit, total) });
};

export const retryJob = (dispatcher: ProcessingDispatcher) => async (req: Request, res: Response): Promise<void> => {
  const actorId = authUserId(req);
  const failedJob = await ProcessingJobModel.findOne({ _id: objectId(requestParam(req, 'jobId')), status: 'failed' });
  if (!failedJob) throw new AppError(409, 'JOB_NOT_RETRYABLE', 'Only failed jobs can be safely retried.');
  const [project, source, owner] = await Promise.all([ProjectModel.findById(failedJob.projectId), VideoAssetModel.findOne({ _id: failedJob.sourceAssetId, state: 'uploaded' }), UserModel.findById(failedJob.ownerId)]);
  if (!project || !source?.durationSeconds || !owner || owner.accountStatus !== 'active') throw new AppError(409, 'JOB_NOT_RETRYABLE', 'The source, project, or account is no longer eligible for a retry.');
  const clips = project.settings?.requestedClipCount ?? 3;
  await reserveProcessing(owner.id, owner.plan, Math.ceil(source.durationSeconds), clips, owner.role);
  try {
    const job = await ProcessingJobModel.create({ ownerId: owner.id, projectId: project.id, sourceAssetId: source.id });
    await ProjectModel.updateOne({ _id: project.id }, { $set: { status: 'queued' }, $unset: { failureCode: 1, failureMessage: 1 } });
    await dispatcher.enqueue(job.id);
    await writeAuditLog({ actorId, action: 'job.retry', targetType: 'processing_job', targetId: job.id, metadata: { retryOf: failedJob.id } });
    res.status(202).json({ job });
  } catch (error) {
    await releaseProcessingReservation(owner.id, Math.ceil(source.durationSeconds), clips);
    throw error;
  }
};

export const cancelJob = async (req: Request, res: Response): Promise<void> => {
  const actorId = authUserId(req);
  const job = await ProcessingJobModel.findOne({ _id: objectId(requestParam(req, 'jobId')), status: 'queued' });
  if (!job) throw new AppError(409, 'JOB_CANNOT_CANCEL', 'Only queued jobs can be cancelled safely.');
  const [project, source] = await Promise.all([ProjectModel.findById(job.projectId), VideoAssetModel.findById(job.sourceAssetId)]);
  if (!project || !source?.durationSeconds) throw new AppError(409, 'JOB_CANNOT_CANCEL', 'The job no longer has the data required for a safe cancellation.');
  job.status = 'cancelled';
  job.cancelledAt = new Date();
  await Promise.all([job.save(), ProjectModel.updateOne({ _id: project.id }, { $set: { status: 'cancelled' } }), releaseProcessingReservation(job.ownerId, Math.ceil(source.durationSeconds), project.settings?.requestedClipCount ?? 3)]);
  await writeAuditLog({ actorId, action: 'job.cancel', targetType: 'processing_job', targetId: job.id });
  res.status(204).send();
};

export const listClips = async (req: Request, res: Response): Promise<void> => {
  const input = paginationSchema.parse(req.query);
  const [total, clips] = await Promise.all([ClipModel.countDocuments({ state: { $ne: 'deleted' } }), ClipModel.find({ state: { $ne: 'deleted' } }).select('ownerId projectId title state score output createdAt expiresAt').populate('ownerId', 'name email').populate('projectId', 'title').sort({ createdAt: -1 }).skip((input.page - 1) * input.limit).limit(input.limit).lean()]);
  res.json({ clips: clips.map((clip) => ({ ...clip, id: String(clip._id) })), pagination: pageResult(input.page, input.limit, total) });
};

export const storageOverview = async (_req: Request, res: Response): Promise<void> => {
  const now = new Date();
  const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const [byKind, byUser, expiring, failedAssets] = await Promise.all([
    VideoAssetModel.aggregate<{ _id: string; bytes: number; count: number }>([{ $match: { state: { $ne: 'deleted' } } }, { $group: { _id: '$kind', bytes: { $sum: '$sizeBytes' }, count: { $sum: 1 } } }]),
    VideoAssetModel.aggregate<{ _id: Types.ObjectId; bytes: number; count: number; email?: string }>([{ $match: { state: { $ne: 'deleted' } } }, { $group: { _id: '$ownerId', bytes: { $sum: '$sizeBytes' }, count: { $sum: 1 } } }, { $sort: { bytes: -1 } }, { $limit: 20 }, { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'owner' } }, { $unwind: { path: '$owner', preserveNullAndEmptyArrays: true } }, { $project: { bytes: 1, count: 1, email: '$owner.email' } }]),
    VideoAssetModel.find({ expiresAt: { $gte: now, $lte: in14Days }, state: { $ne: 'deleted' } }).select('ownerId originalFilename kind sizeBytes expiresAt').sort({ expiresAt: 1 }).limit(25).populate('ownerId', 'email').lean(),
    VideoAssetModel.find({ state: 'failed' }).select('ownerId originalFilename kind sizeBytes updatedAt').sort({ updatedAt: -1 }).limit(25).populate('ownerId', 'email').lean()
  ]);
  res.json({ byKind, byUser: byUser.map((item) => ({ id: String(item._id), bytes: item.bytes, count: item.count, email: item.email ?? 'Deleted account' })), expiring, failedAssets, cleanup: { available: false, message: 'No recurring storage cleanup worker is configured.' }, reconciliation: { available: false, message: 'Orphan reconciliation has not been implemented.' } });
};

export const listSubscriptions = async (req: Request, res: Response): Promise<void> => {
  const input = paginationSchema.parse(req.query);
  const [total, subscriptions] = await Promise.all([SubscriptionModel.countDocuments(), SubscriptionModel.find().populate('ownerId', 'name email').sort({ currentPeriodEnd: -1 }).skip((input.page - 1) * input.limit).limit(input.limit).lean()]);
  res.json({ subscriptions, pagination: pageResult(input.page, input.limit, total) });
};

export const listPayments = async (req: Request, res: Response): Promise<void> => {
  const input = paginationSchema.parse(req.query);
  const [total, payments] = await Promise.all([PaymentModel.countDocuments(), PaymentModel.find().select('ownerId provider providerReference amountPaisa currency status verifiedAt createdAt').populate('ownerId', 'name email').sort({ createdAt: -1 }).skip((input.page - 1) * input.limit).limit(input.limit).lean()]);
  res.json({ payments, pagination: pageResult(input.page, input.limit, total) });
};

export const plans = (_req: Request, res: Response): void => {
  res.json({ plans: Object.values(PLANS), configuration: { editable: false, source: 'Deployment configuration', message: 'Plan configuration is currently source-controlled; no admin mutation endpoint is available.' } });
};

export const health = (env: Env, dispatcher: ProcessingDispatcher) => async (_req: Request, res: Response): Promise<void> => {
  const [queue, errors] = await Promise.all([dispatcher.getHealth(), ProcessingJobModel.find({ status: 'failed' }).select('errorCode updatedAt projectId').sort({ updatedAt: -1 }).limit(8).lean()]);
  const transcriptionConfigured = env.TRANSCRIPTION_PROVIDER === 'whisper_local'
    ? Boolean(env.WHISPER_COMMAND)
    : env.TRANSCRIPTION_PROVIDER === 'openai'
      ? Boolean(env.TRANSCRIPTION_API_KEY)
      : env.TRANSCRIPTION_PROVIDER === 'mock';
  const aiConfigured = env.AI_PROVIDER === 'gemini' ? Boolean(env.AI_API_KEY) : env.AI_PROVIDER === 'mock';
  res.json({
    api: { status: 'ok' },
    database: { connected: mongoose.connection.readyState === 1 },
    queue,
    storage: { provider: env.STORAGE_PROVIDER, configured: env.STORAGE_PROVIDER === 'local' || Boolean(env.R2_ENDPOINT && env.R2_BUCKET) },
    providers: {
      transcription: { provider: env.TRANSCRIPTION_PROVIDER, configured: transcriptionConfigured },
      selection: { provider: env.AI_PROVIDER, configured: aiConfigured, transcriptFallbackAvailable: env.AI_PROVIDER === 'none' },
      paymentsMode: env.PAYMENTS_MODE
    },
    recentErrors: errors.map((entry) => ({ jobId: String(entry._id), projectId: String(entry.projectId), code: entry.errorCode ?? 'PROCESSING_FAILED', updatedAt: entry.updatedAt }))
  });
};

export const auditLogs = async (req: Request, res: Response): Promise<void> => {
  const input = paginationSchema.parse(req.query);
  const [total, logs] = await Promise.all([AuditLogModel.countDocuments(), AuditLogModel.find().populate('actorId', 'name email').sort({ createdAt: -1 }).skip((input.page - 1) * input.limit).limit(input.limit).lean()]);
  res.json({ logs, pagination: pageResult(input.page, input.limit, total) });
};
