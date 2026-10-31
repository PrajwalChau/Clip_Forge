import { describe, expect, it } from 'vitest';
import { getPlan, monthlyPeriod, validateClipWindow } from '../services/plans.js';

describe('plan entitlements', () => {
  it('uses the launch free limits', () => {
    expect(getPlan('free')).toMatchObject({ storageBytes: 1_000_000_000, processingSeconds: 1_800, generatedClips: 15, outputHeight: 720, watermark: true, retentionDays: 7 });
  });
  it('resets usage at the start of the next UTC calendar month', () => {
    const period = monthlyPeriod(new Date('2026-10-22T12:00:00Z'));
    expect(period).toEqual({ key: '2026-10', resetAt: new Date('2026-11-01T00:00:00Z') });
  });
});

describe('clip window validation', () => {
  it('rejects clip windows outside source duration', () => expect(() => validateClipWindow(29, 61, 60)).toThrow(/past the end/));
  it('rejects inverted clip windows', () => expect(() => validateClipWindow(45, 45, 60)).toThrow(/valid start/));
  it('accepts valid clip windows', () => expect(() => validateClipWindow(15, 45, 60)).not.toThrow());
});
