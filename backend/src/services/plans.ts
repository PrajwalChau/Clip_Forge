export type PlanName = 'free' | 'pro' | 'premium';

export type Plan = {
  id: PlanName;
  label: string;
  priceNpr: number;
  storageBytes: number;
  processingSeconds: number;
  generatedClips: number;
  outputHeight: 720 | 1080;
  watermark: boolean;
  retentionDays: number;
};

export const PLANS: Record<PlanName, Plan> = {
  free: { id: 'free', label: 'Free', priceNpr: 0, storageBytes: 1_000_000_000, processingSeconds: 1_800, generatedClips: 15, outputHeight: 720, watermark: true, retentionDays: 7 },
  pro: { id: 'pro', label: 'Pro', priceNpr: 499, storageBytes: 10_000_000_000, processingSeconds: 10_800, generatedClips: 30, outputHeight: 1080, watermark: false, retentionDays: 30 },
  premium: { id: 'premium', label: 'Premium', priceNpr: 1_499, storageBytes: 50_000_000_000, processingSeconds: 36_000, generatedClips: 100, outputHeight: 1080, watermark: false, retentionDays: 90 }
};

export const getPlan = (plan: string): Plan => PLANS[plan as PlanName] ?? PLANS.free;

export const monthlyPeriod = (date = new Date()): { key: string; resetAt: Date } => {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const key = `${year}-${String(month + 1).padStart(2, '0')}`;
  return { key, resetAt: new Date(Date.UTC(year, month + 1, 1)) };
};

export const validateClipWindow = (startSeconds: number, endSeconds: number, sourceDurationSeconds: number): void => {
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds) {
    throw new Error('A clip must have a valid start time and an end time after its start time.');
  }
  if (endSeconds > sourceDurationSeconds) {
    throw new Error('A clip cannot extend past the end of its source video.');
  }
};
