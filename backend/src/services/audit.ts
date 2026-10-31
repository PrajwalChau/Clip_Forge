import type { Types } from 'mongoose';
import { AuditLogModel } from '../models/AuditLog.js';

type SafeValue = string | number | boolean | null;

const sanitizeMetadata = (metadata: Record<string, unknown> | undefined): Record<string, SafeValue> => Object.fromEntries(
  Object.entries(metadata ?? {}).filter(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value)).map(([key, value]) => [key.slice(0, 80), value as SafeValue])
);

export const writeAuditLog = async (entry: { actorId: string | Types.ObjectId; action: string; targetType: string; targetId: string; reason?: string; outcome?: 'success' | 'failure'; metadata?: Record<string, unknown> }): Promise<void> => {
  await AuditLogModel.create({ ...entry, reason: entry.reason?.trim().slice(0, 500), outcome: entry.outcome ?? 'success', metadata: sanitizeMetadata(entry.metadata) });
};
