import type { Request, Response } from 'express';
import { z } from 'zod';
import { authUserId } from '../middleware/auth.js';
import { ClipModel } from '../models/Clip.js';
import { VideoAssetModel } from '../models/VideoAsset.js';
import { deleteStoredBytes } from '../services/quota.js';
import type { StorageService } from '../services/storage.js';
import { AppError } from '../utils/errors.js';

const updateClipSchema = z.object({ title: z.string().trim().min(1).max(160).optional(), startSeconds: z.number().min(0).optional(), endSeconds: z.number().positive().optional() }).refine((value) => value.startSeconds === undefined || value.endSeconds === undefined || value.endSeconds > value.startSeconds, { message: 'The clip end must be after its start.' });

export const listClips = async (req: Request, res: Response): Promise<void> => {
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
  const clips = await ClipModel.find({ ownerId: authUserId(req), ...(projectId ? { projectId } : {}), state: { $ne: 'deleted' } }).sort({ createdAt: -1 }).lean();
  res.json({ clips });
};

export const getClip = async (req: Request, res: Response): Promise<void> => {
  const clip = await ClipModel.findOne({ _id: req.params.clipId, ownerId: authUserId(req), state: { $ne: 'deleted' } }).lean();
  if (!clip) throw new AppError(404, 'CLIP_NOT_FOUND', 'This clip was not found.');
  res.json({ clip });
};

export const updateClip = async (req: Request, res: Response): Promise<void> => {
  const input = updateClipSchema.parse(req.body);
  const clip = await ClipModel.findOneAndUpdate({ _id: req.params.clipId, ownerId: authUserId(req), state: 'ready' }, { $set: input }, { new: true });
  if (!clip) throw new AppError(404, 'CLIP_NOT_FOUND', 'Only ready clips can be edited.');
  res.json({ clip });
};

export const downloadClip = (storage: StorageService) => async (req: Request, res: Response): Promise<void> => {
  const clip = await ClipModel.findOne({ _id: req.params.clipId, ownerId: authUserId(req), state: 'ready' });
  if (!clip?.assetId) throw new AppError(404, 'CLIP_NOT_FOUND', 'This rendered clip is not available.');
  const asset = await VideoAssetModel.findOne({ _id: clip.assetId, ownerId: clip.ownerId, state: 'ready' });
  if (!asset) throw new AppError(404, 'FILE_NOT_FOUND', 'The rendered clip file was not found.');
  res.json({ url: await storage.signedDownloadUrl(asset.objectKey), expiresInSeconds: 300 });
};

export const deleteClip = (storage: StorageService) => async (req: Request, res: Response): Promise<void> => {
  const clip = await ClipModel.findOne({ _id: req.params.clipId, ownerId: authUserId(req), state: { $ne: 'deleted' } });
  if (!clip) throw new AppError(404, 'CLIP_NOT_FOUND', 'This clip was not found.');
  if (clip.assetId) {
    const asset = await VideoAssetModel.findOne({ _id: clip.assetId, ownerId: clip.ownerId, state: { $ne: 'deleted' } });
    if (asset) { await storage.delete(asset.objectKey); asset.state = 'deleted'; asset.deletedAt = new Date(); await asset.save(); await deleteStoredBytes(asset.ownerId, asset.sizeBytes); }
  }
  clip.state = 'deleted';
  clip.deletedAt = new Date();
  await clip.save();
  res.status(204).send();
};
