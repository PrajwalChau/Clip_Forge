import { readFile } from 'node:fs/promises';
import type { Env } from '../../config/env.js';
import { getTokenEncryptionKey } from '../../config/env.js';
import { SocialAccountModel } from '../../models/SocialAccount.js';
import { decryptToken, encryptToken } from '../../utils/crypto.js';
import { AppError } from '../../utils/errors.js';
import { PLATFORM_SPECS, type PublishOptions, type PublishResult, type SocialPlatform } from './types.js';

export type MediaVerification = {
  valid: boolean;
  durationSeconds: number;
  width?: number | null;
  height?: number | null;
  aspectRatio: string;
  errors: string[];
};

/**
 * Validates that a clip video satisfies the target platform's media specifications.
 */
export const verifyMediaForPlatform = (
  platform: SocialPlatform,
  media: { durationSeconds: number; width?: number | null; height?: number | null }
): MediaVerification => {
  const spec = PLATFORM_SPECS[platform];
  const errors: string[] = [];

  if (media.durationSeconds > spec.maxDurationSeconds) {
    errors.push(`Clip duration (${media.durationSeconds.toFixed(1)}s) exceeds ${spec.displayName} maximum of ${spec.maxDurationSeconds}s.`);
  }

  if (media.durationSeconds < spec.minDurationSeconds) {
    errors.push(`Clip duration (${media.durationSeconds.toFixed(1)}s) is shorter than ${spec.displayName} minimum of ${spec.minDurationSeconds}s.`);
  }

  // Check aspect ratio if width & height available
  let detectedRatio = '9:16';
  if (media.width && media.height) {
    const ratio = media.width / media.height;
    // 9/16 is 0.5625
    if (ratio > 0.65) {
      errors.push(`Aspect ratio is not vertical 9:16 (detected resolution ${media.width}x${media.height}).`);
      detectedRatio = `${media.width}:${media.height}`;
    }
  }

  return {
    valid: errors.length === 0,
    durationSeconds: media.durationSeconds,
    width: media.width,
    height: media.height,
    aspectRatio: detectedRatio,
    errors
  };
};

/**
 * Refreshes Google OAuth access token if expired and refresh token is available
 */
const refreshYouTubeToken = async (
  accountId: string,
  encryptedRefreshToken: string,
  env: Env
): Promise<string> => {
  const encryptionKey = getTokenEncryptionKey(env);
  const refreshToken = decryptToken(encryptedRefreshToken, encryptionKey);

  if (!env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET) {
    throw new AppError(503, 'PLATFORM_NOT_CONFIGURED', 'YouTube OAuth credentials missing.');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.YOUTUBE_CLIENT_ID,
      client_secret: env.YOUTUBE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    }).toString()
  });

  if (!res.ok) {
    throw new AppError(401, 'TOKEN_REFRESH_FAILED', 'Could not refresh YouTube access token. Please reconnect the account.');
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  const newAccessToken = data.access_token;
  const newExpiresAt = new Date(Date.now() + data.expires_in * 1000);

  await SocialAccountModel.updateOne(
    { accountId, platform: 'youtube' },
    {
      $set: {
        encryptedAccessToken: encryptToken(newAccessToken, encryptionKey),
        tokenExpiresAt: newExpiresAt,
        status: 'connected',
        lastError: undefined
      }
    }
  );

  return newAccessToken;
};

/**
 * Publishes a video clip to the specified connected social account.
 */
export const publishClipToPlatform = async (
  socialAccountId: string,
  ownerId: string,
  videoFilePath: string,
  mediaMeta: { durationSeconds: number; width?: number | null; height?: number | null },
  options: PublishOptions,
  env: Env
): Promise<PublishResult> => {
  const account = await SocialAccountModel.findOne({ _id: socialAccountId, ownerId })
    .select('+encryptedAccessToken +encryptedRefreshToken')
    .lean();

  if (!account) {
    throw new AppError(404, 'SOCIAL_ACCOUNT_NOT_FOUND', 'The selected social account was not found or access is revoked.');
  }

  if (account.status === 'disconnected') {
    throw new AppError(409, 'ACCOUNT_DISCONNECTED', 'This social account is disconnected. Reconnect it before publishing.');
  }

  // 1. Verify media meets platform specifications
  const verification = verifyMediaForPlatform(account.platform as SocialPlatform, mediaMeta);
  if (!verification.valid) {
    throw new AppError(422, 'MEDIA_SPECIFICATION_VIOLATION', verification.errors.join(' '));
  }

  const encryptionKey = getTokenEncryptionKey(env);
  const isSimulated = (account.metadata as Record<string, unknown> | undefined)?.isSimulated === true;

  // 2. Simulated/Development test account handling
  if (isSimulated) {
    // Simulate brief processing network delay
    await new Promise((resolve) => setTimeout(resolve, 800));
    const randomId = Math.random().toString(36).substring(2, 11);
    const publishedAt = new Date();

    const postUrls: Record<string, string> = {
      youtube: `https://youtube.com/shorts/${randomId}`,
      tiktok: `https://tiktok.com/@${account.accountHandle || 'test'}/video/${randomId}`,
      instagram: `https://instagram.com/reel/${randomId}/`,
      facebook: `https://facebook.com/reel/${randomId}`
    };

    return {
      platformPostId: `post_${account.platform}_${randomId}`,
      platformPostUrl: postUrls[account.platform] || `https://example.com/post/${randomId}`,
      publishedAt
    };
  }

  // 3. Real platform publishing
  let accessToken: string;
  try {
    accessToken = decryptToken(account.encryptedAccessToken, encryptionKey);
  } catch {
    throw new AppError(500, 'TOKEN_DECRYPTION_FAILED', 'Failed to decrypt credentials for this social account.');
  }

  // Check if token expired and refresh if possible
  if (account.tokenExpiresAt && new Date() >= new Date(account.tokenExpiresAt)) {
    if (account.platform === 'youtube' && account.encryptedRefreshToken) {
      accessToken = await refreshYouTubeToken(account.accountId, account.encryptedRefreshToken, env);
    } else {
      await SocialAccountModel.updateOne(
        { _id: account._id },
        { $set: { status: 'expired', lastError: 'Access token expired. Reconnection required.' } }
      );
      throw new AppError(401, 'ACCOUNT_TOKEN_EXPIRED', 'Social account access token has expired. Please reconnect.');
    }
  }

  switch (account.platform) {
    case 'youtube': {
      // YouTube Data API v3 video upload
      const videoBuffer = await readFile(videoFilePath);
      const title = options.title.slice(0, 100);
      const description = `${options.caption}\n\n${(options.tags || []).map((t) => `#${t}`).join(' ')}`.trim();
      const privacyStatus = options.privacy || 'public';

      // Initialize resumable upload or direct upload
      const metadataPart = {
        snippet: {
          title,
          description,
          tags: options.tags || ['Shorts', 'ClipForge'],
          categoryId: '22' // People & Blogs
        },
        status: {
          privacyStatus,
          selfDeclaredMadeForKids: false
        }
      };

      const uploadUrl = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status';
      const boundary = `-------ClipForgeBoundary${Date.now()}`;
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelimiter = `\r\n--${boundary}--`;

      const multipartBody = Buffer.concat([
        Buffer.from(`${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadataPart)}\r\n`),
        Buffer.from(`${delimiter}Content-Type: video/mp4\r\n\r\n`),
        videoBuffer,
        Buffer.from(closeDelimiter)
      ]);

      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Content-Length': String(multipartBody.length)
        },
        body: multipartBody
      });

      if (!res.ok) {
        const errJson = await res.text();
        throw new AppError(502, 'YOUTUBE_PUBLISH_FAILED', `YouTube rejected upload: ${errJson.slice(0, 300)}`);
      }

      const result = await res.json() as { id?: string };
      if (!result.id) {
        throw new AppError(502, 'YOUTUBE_NO_CONFIRMATION', 'YouTube upload finished but returned no video ID.');
      }

      return {
        platformPostId: result.id,
        platformPostUrl: `https://youtube.com/shorts/${result.id}`,
        publishedAt: new Date()
      };
    }

    default:
      throw new AppError(501, 'PLATFORM_NOT_ACTIVE', `Live publishing for ${account.platform} requires official API approval. Use development test mode or YouTube.`);
  }
};
