import { rm } from 'node:fs/promises';
import type { Request, Response } from 'express';
import type { FileFilterCallback } from 'multer';
import multer from 'multer';
import { extname, join } from 'node:path';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { authUserId } from '../middleware/auth.js';
import { ProjectModel } from '../models/Project.js';
import { UserModel } from '../models/User.js';
import { VideoAssetModel } from '../models/VideoAsset.js';
import { probeVideo } from '../services/media.js';
import { commitStorage, deleteStoredBytes, releaseStorageReservation, reserveStorage } from '../services/quota.js';
import type { StorageService } from '../services/storage.js';
import { AppError } from '../utils/errors.js';
import { newObjectKey } from '../utils/ids.js';

const allowedMimes = new Set(['video/mp4']);
const uploadRoot = join(process.cwd(), 'uploads');

export const videoUpload = (env: Env) => multer({
  dest: uploadRoot,
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req: Request, file, callback: FileFilterCallback) => {
    if (!allowedMimes.has(file.mimetype)) { callback(new AppError(422, 'UNSUPPORTED_MEDIA_TYPE', 'Only MP4 source videos are supported in this MVP.')); return; }
    callback(null, true);
  }
});

const optionalText = z.preprocess((value) => typeof value === 'string' && value.trim() === '' ? undefined : value, z.string().trim().max(2_000).optional());
const optionalUrl = z.preprocess((value) => typeof value === 'string' && value.trim() === '' ? undefined : value, z.string().trim().url().max(2_048).optional());
export const sourceUploadSchema = z.object({
  projectId: z.string().min(1),
  rightsConfirmed: z.preprocess((value) => value === true || value === 'true', z.boolean()),
  sourceUrl: optionalUrl,
  creator: z.preprocess((value) => typeof value === 'string' && value.trim() === '' ? undefined : value, z.string().trim().max(255).optional()),
  licenseType: z.enum(['unknown', 'owned', 'licensed', 'cc0', 'cc_by', 'cc_by_nc', 'cc_by_nd', 'other']).default('unknown'),
  licenseUrl: optionalUrl,
  attributionText: optionalText
});
const idSchema = z.object({ assetId: z.string().min(1) });

export const uploadVideo = (env: Env, storage: StorageService) => async (req: Request, res: Response): Promise<void> => {
  const ownerId = authUserId(req);
  const input = sourceUploadSchema.parse(req.body);
  if (!req.file) throw new AppError(422, 'VIDEO_REQUIRED', 'Choose an authorized MP4 video to upload.');
  const file = req.file;
  const user = await UserModel.findById(ownerId);
  const project = await ProjectModel.findOne({ _id: input.projectId, ownerId });
  if (!user || !project) { await rm(file.path, { force: true }); throw new AppError(404, 'PROJECT_NOT_FOUND', 'This project was not found.'); }
  if (project.sourceAssetId) { await rm(file.path, { force: true }); throw new AppError(409, 'SOURCE_ALREADY_EXISTS', 'This project already has a source video. Create a new project to use another source.'); }
  let reserved = false;
  let storedKey: string | undefined;
  try {
    await reserveStorage(ownerId, user.plan, file.size);
    reserved = true;
    const metadata = await probeVideo(file.path, env);
    const objectKey = newObjectKey(ownerId, 'source', extname(file.originalname));
    storedKey = objectKey;
    const stored = await storage.putFromPath(objectKey, file.path);
    const commercialUseRestricted = input.licenseType === 'cc_by_nc';
    const derivativeWorksRestricted = input.licenseType === 'cc_by_nd';
    const asset = await VideoAssetModel.create({ ownerId, projectId: project.id, kind: 'source', originalFilename: file.originalname, mimeType: 'video/mp4', sizeBytes: stored.sizeBytes, durationSeconds: metadata.durationSeconds, width: metadata.width, height: metadata.height, storageProvider: env.STORAGE_PROVIDER, objectKey, state: 'uploaded', source: { type: 'user_upload', rightsConfirmed: input.rightsConfirmed, ...(input.rightsConfirmed ? { rightsConfirmedAt: new Date() } : {}), provenance: 'user_declared', sourceUrl: input.sourceUrl, creator: input.creator, licenseType: input.licenseType, licenseUrl: input.licenseUrl, attributionText: input.attributionText, commercialUseRestricted, derivativeWorksRestricted } });
    project.sourceAssetId = asset._id;
    project.status = 'uploaded';
    await project.save();
    await commitStorage(ownerId, stored.sizeBytes);
    reserved = false;
    res.status(201).json({ asset, project });
  } catch (error) {
    if (storedKey) await storage.delete(storedKey).catch(() => undefined);
    if (reserved) await releaseStorageReservation(ownerId, file.size);
    throw error;
  } finally {
    await rm(file.path, { force: true });
  }
};

export const storageUsage = async (req: Request, res: Response): Promise<void> => {
  const ownerId = authUserId(req);
  const { monthlyPeriod, getPlan } = await import('../services/plans.js');
  const { UsageModel } = await import('../models/Usage.js');
  const user = await UserModel.findById(ownerId);
  if (!user) throw new AppError(401, 'SESSION_INVALID', 'Your session has expired. Please sign in again.');
  const period = monthlyPeriod();
  const usage = await UsageModel.findOne({ ownerId, periodKey: period.key }).lean();
  res.json({ plan: getPlan(user.plan), usage: usage ?? { storageBytes: 0, reservedBytes: 0, processingSeconds: 0, generatedClips: 0, resetAt: period.resetAt } });
};

export const listFiles = async (req: Request, res: Response): Promise<void> => {
  const files = await VideoAssetModel.find({ ownerId: authUserId(req), state: { $ne: 'deleted' } }).sort({ createdAt: -1 }).lean();
  res.json({ files });
};

export const getDownloadUrl = (storage: StorageService) => async (req: Request, res: Response): Promise<void> => {
  const { assetId } = idSchema.parse(req.body);
  const asset = await VideoAssetModel.findOne({ _id: assetId, ownerId: authUserId(req), state: 'ready' });
  if (!asset) throw new AppError(404, 'FILE_NOT_FOUND', 'This file is not available for download.');
  res.json({ url: await storage.signedDownloadUrl(asset.objectKey), expiresInSeconds: 300 });
};

export const serveLocalFile = (storage: StorageService) => async (req: Request, res: Response): Promise<void> => {
  const rawObjectKey = req.params.objectKey;
  const objectKey = decodeURIComponent(typeof rawObjectKey === 'string' ? rawObjectKey : '');
  const asset = await VideoAssetModel.findOne({ objectKey, ownerId: authUserId(req), state: 'ready' });
  if (!asset) throw new AppError(404, 'FILE_NOT_FOUND', 'This file is not available.');
  if (!storage.getLocalPath) throw new AppError(404, 'LOCAL_STORAGE_DISABLED', 'Local storage is not active.');
  res.type(asset.mimeType).sendFile(storage.getLocalPath(objectKey));
};

export const deleteFile = (storage: StorageService) => async (req: Request, res: Response): Promise<void> => {
  const asset = await VideoAssetModel.findOne({ _id: req.params.assetId, ownerId: authUserId(req), state: { $ne: 'deleted' } });
  if (!asset) throw new AppError(404, 'FILE_NOT_FOUND', 'This file was not found.');
  const inFlight = await (await import('../models/ProcessingJob.js')).ProcessingJobModel.exists({ sourceAssetId: asset.id, status: { $in: ['queued', 'processing'] } });
  if (inFlight) throw new AppError(409, 'FILE_IN_USE', 'This source video cannot be deleted while it is processing.');
  await storage.delete(asset.objectKey);
  asset.state = 'deleted';
  asset.deletedAt = new Date();
  await asset.save();
  if (asset.kind === 'source') await ProjectModel.updateOne({ _id: asset.projectId, sourceAssetId: asset._id }, { $unset: { sourceAssetId: 1 }, $set: { status: 'draft' } });
  await deleteStoredBytes(asset.ownerId, asset.sizeBytes);
  res.status(204).send();
};
