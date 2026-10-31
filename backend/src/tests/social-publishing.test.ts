import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken } from '../utils/crypto.js';
import { PLATFORM_SPECS } from '../services/social/types.js';
import { verifyMediaForPlatform } from '../services/social/publisher.js';

describe('Token encryption and decryption', () => {
  const secretKey = 'my-super-secret-jwt-key-that-is-at-least-32-chars-long';

  it('encrypts and decrypts an OAuth access token symmetrically', () => {
    const rawToken = 'ya29.a0AfH6SMB_SAMPLE_ACCESS_TOKEN_FOR_YOUTUBE_API_12345';
    const encrypted = encryptToken(rawToken, secretKey);

    expect(encrypted).not.toBe(rawToken);
    expect(encrypted.split(':')).toHaveLength(3); // iv:tag:data

    const decrypted = decryptToken(encrypted, secretKey);
    expect(decrypted).toBe(rawToken);
  });

  it('fails decryption with wrong secret key', () => {
    const rawToken = 'secret-refresh-token';
    const encrypted = encryptToken(rawToken, secretKey);

    expect(() => decryptToken(encrypted, 'wrong-secret-key-that-is-also-32-chars-long')).toThrow();
  });
});

describe('Platform media specifications verification', () => {
  it('passes valid 15-second 9:16 vertical clip for YouTube Shorts', () => {
    const result = verifyMediaForPlatform('youtube', {
      durationSeconds: 15,
      width: 1080,
      height: 1920
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('passes 30-second 9:16 vertical clip for YouTube Shorts', () => {
    const result = verifyMediaForPlatform('youtube', {
      durationSeconds: 30,
      width: 1080,
      height: 1920
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects video exceeding YouTube Shorts 60-second limit', () => {
    const result = verifyMediaForPlatform('youtube', {
      durationSeconds: 65,
      width: 1080,
      height: 1920
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('exceeds'))).toBe(true);
  });

  it('detects horizontal video that violates 9:16 vertical spec', () => {
    const result = verifyMediaForPlatform('youtube', {
      durationSeconds: 15,
      width: 1920,
      height: 1080 // 16:9 landscape
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Aspect ratio is not vertical 9:16'))).toBe(true);
  });

  it('supports TikTok and Instagram Reels duration limits', () => {
    expect(PLATFORM_SPECS.tiktok.maxDurationSeconds).toBe(60);
    expect(PLATFORM_SPECS.instagram.maxDurationSeconds).toBe(90);
    expect(PLATFORM_SPECS.facebook.maxDurationSeconds).toBe(60);

    const tiktokCheck = verifyMediaForPlatform('tiktok', { durationSeconds: 15, width: 720, height: 1280 });
    expect(tiktokCheck.valid).toBe(true);

    const igCheck = verifyMediaForPlatform('instagram', { durationSeconds: 75, width: 1080, height: 1920 });
    expect(igCheck.valid).toBe(true);
  });
});
