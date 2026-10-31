import type { Types } from 'mongoose';
import { UsageModel } from '../models/Usage.js';
import { getPlan, monthlyPeriod } from './plans.js';
import { AppError } from '../utils/errors.js';

type Id = string | Types.ObjectId;

const ensureUsage = async (ownerId: Id) => {
  const period = monthlyPeriod();
  await UsageModel.updateOne({ ownerId, periodKey: period.key }, { $setOnInsert: { ownerId, periodKey: period.key, resetAt: period.resetAt } }, { upsert: true });
  return period;
};

export const reserveStorage = async (ownerId: Id, planName: string, bytes: number): Promise<void> => {
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new AppError(400, 'INVALID_SIZE', 'The upload size is invalid.');
  const period = await ensureUsage(ownerId);
  const plan = getPlan(planName);
  const result = await UsageModel.updateOne(
    { ownerId, periodKey: period.key, $expr: { $lte: [{ $add: ['$storageBytes', '$reservedBytes', bytes] }, plan.storageBytes] } },
    { $inc: { reservedBytes: bytes } }
  );
  if (result.modifiedCount !== 1) throw new AppError(409, 'STORAGE_QUOTA_EXCEEDED', 'This upload would exceed your available storage. You can still download or delete existing files.');
};

export const commitStorage = async (ownerId: Id, bytes: number): Promise<void> => {
  const period = await ensureUsage(ownerId);
  const result = await UsageModel.updateOne({ ownerId, periodKey: period.key, reservedBytes: { $gte: bytes } }, { $inc: { reservedBytes: -bytes, storageBytes: bytes } });
  if (result.modifiedCount !== 1) throw new AppError(409, 'STORAGE_RESERVATION_MISSING', 'The upload reservation is no longer valid.');
};

export const releaseStorageReservation = async (ownerId: Id, bytes: number): Promise<void> => {
  const period = monthlyPeriod();
  await UsageModel.updateOne({ ownerId, periodKey: period.key, reservedBytes: { $gte: bytes } }, { $inc: { reservedBytes: -bytes } });
};

export const deleteStoredBytes = async (ownerId: Id, bytes: number): Promise<void> => {
  const period = monthlyPeriod();
  await UsageModel.updateOne({ ownerId, periodKey: period.key, storageBytes: { $gte: bytes } }, { $inc: { storageBytes: -bytes } });
};

export const reserveProcessing = async (ownerId: Id, planName: string, processingSeconds: number, clips: number, role: 'user' | 'admin' = 'user'): Promise<void> => {
  if (processingSeconds <= 0 || clips < 1) throw new AppError(400, 'INVALID_PROCESSING_REQUEST', 'This processing request is invalid.');
  const period = await ensureUsage(ownerId);
  const plan = getPlan(planName);
  const limits = [
    { $lte: [{ $add: ['$processingSeconds', '$reservedProcessingSeconds', processingSeconds] }, plan.processingSeconds] },
    ...(role === 'admin' ? [] : [{ $lte: [{ $add: ['$generatedClips', '$reservedGeneratedClips', clips] }, plan.generatedClips] }])
  ];
  const result = await UsageModel.updateOne(
    { ownerId, periodKey: period.key, $expr: { $and: limits } },
    { $inc: { reservedProcessingSeconds: processingSeconds, reservedGeneratedClips: clips } }
  );
  if (result.modifiedCount !== 1) throw new AppError(409, 'PLAN_LIMIT_REACHED', 'Your plan does not have enough processing time or clip output remaining.');
};

export const completeReservedProcessing = async (ownerId: Id, processingSeconds: number, reservedClips: number, renderedClips: number): Promise<void> => {
  const period = await ensureUsage(ownerId);
  const result = await UsageModel.updateOne(
    { ownerId, periodKey: period.key, reservedProcessingSeconds: { $gte: processingSeconds }, reservedGeneratedClips: { $gte: reservedClips } },
    { $inc: { reservedProcessingSeconds: -processingSeconds, reservedGeneratedClips: -reservedClips, processingSeconds, generatedClips: renderedClips } }
  );
  if (result.modifiedCount !== 1) throw new AppError(409, 'PROCESSING_RESERVATION_MISSING', 'The processing reservation is no longer valid.');
};

export const releaseProcessingReservation = async (ownerId: Id, processingSeconds: number, clips: number): Promise<void> => {
  const period = monthlyPeriod();
  await UsageModel.updateOne({ ownerId, periodKey: period.key, reservedProcessingSeconds: { $gte: processingSeconds }, reservedGeneratedClips: { $gte: clips } }, { $inc: { reservedProcessingSeconds: -processingSeconds, reservedGeneratedClips: -clips } });
};
