import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Env } from '../../config/env.js';
import { getTokenEncryptionKey } from '../../config/env.js';
import { SocialAccountModel } from '../../models/SocialAccount.js';
import { decryptToken, encryptToken } from '../../utils/crypto.js';
import { AppError } from '../../utils/errors.js';
import type { SocialPlatform } from './types.js';

export type PlatformConfigStatus = {
  platform: SocialPlatform;
  displayName: string;
  configured: boolean;
  missingFields: string[];
};

const OAUTH_STATE_TTL_SECONDS = 600;

const buildPlatformRedirectUri = (platform: SocialPlatform, env: Env): string => {
  const redirectOrigin = env.FRONTEND_URL;
  switch (platform) {
    case 'youtube':
      return env.YOUTUBE_REDIRECT_URI || `${redirectOrigin}/app/social`;
    case 'tiktok':
      return env.TIKTOK_REDIRECT_URI || `${redirectOrigin}/app/social`;
    case 'instagram':
    case 'facebook':
      return env.META_REDIRECT_URI || `${redirectOrigin}/app/social`;
    default:
      return `${redirectOrigin}/app/social`;
  }
};

export const createOAuthState = (ownerId: string, platform: SocialPlatform, env: Env): string => {
  return jwt.sign({ sub: ownerId, platform, nonce: crypto.randomBytes(16).toString('hex') }, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: `${OAUTH_STATE_TTL_SECONDS}s`,
    issuer: 'clipforge-api'
  });
};

export const decodeOAuthState = (state: string, env: Env): { sub: string; platform: SocialPlatform } => {
  const payload = jwt.verify(state, env.JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: 'clipforge-api'
  }) as { sub?: string; platform?: string };

  if (!payload.sub || !payload.platform) {
    throw new AppError(401, 'OAUTH_STATE_INVALID', 'The OAuth state is missing user or platform info.');
  }

  if (!['youtube', 'tiktok', 'instagram', 'facebook'].includes(payload.platform)) {
    throw new AppError(403, 'OAUTH_STATE_INVALID_PLATFORM', 'The OAuth state contains an unsupported platform.');
  }

  return { sub: payload.sub, platform: payload.platform as SocialPlatform };
};

export const verifyOAuthState = (state: string, expectedPlatform: SocialPlatform, env: Env): string => {
  const payload = decodeOAuthState(state, env);

  if (payload.platform !== expectedPlatform) {
    throw new AppError(403, 'OAUTH_STATE_MISMATCH', 'The OAuth state does not match the requested platform.');
  }

  return payload.sub;
};

export const getPlatformConfigStatus = (env: Env): Record<SocialPlatform, PlatformConfigStatus> => {
  return {
    youtube: {
      platform: 'youtube',
      displayName: 'YouTube Shorts',
      configured: Boolean(env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET),
      missingFields: [
        ...(!env.YOUTUBE_CLIENT_ID ? ['YOUTUBE_CLIENT_ID'] : []),
        ...(!env.YOUTUBE_CLIENT_SECRET ? ['YOUTUBE_CLIENT_SECRET'] : [])
      ]
    },
    tiktok: {
      platform: 'tiktok',
      displayName: 'TikTok',
      configured: Boolean(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET),
      missingFields: [
        ...(!env.TIKTOK_CLIENT_KEY ? ['TIKTOK_CLIENT_KEY'] : []),
        ...(!env.TIKTOK_CLIENT_SECRET ? ['TIKTOK_CLIENT_SECRET'] : [])
      ]
    },
    instagram: {
      platform: 'instagram',
      displayName: 'Instagram Reels',
      configured: Boolean(env.META_APP_ID && env.META_APP_SECRET),
      missingFields: [
        ...(!env.META_APP_ID ? ['META_APP_ID'] : []),
        ...(!env.META_APP_SECRET ? ['META_APP_SECRET'] : [])
      ]
    },
    facebook: {
      platform: 'facebook',
      displayName: 'Facebook Reels',
      configured: Boolean(env.META_APP_ID && env.META_APP_SECRET),
      missingFields: [
        ...(!env.META_APP_ID ? ['META_APP_ID'] : []),
        ...(!env.META_APP_SECRET ? ['META_APP_SECRET'] : [])
      ]
    }
  };
};

export const getOAuthAuthorizationUrl = (
  platform: SocialPlatform,
  state: string,
  env: Env
): string => {
  switch (platform) {
    case 'youtube': {
      if (!env.YOUTUBE_CLIENT_ID) {
        throw new AppError(503, 'PLATFORM_NOT_CONFIGURED', 'YouTube OAuth is not configured. Add YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET to .env.');
      }
      const redirectUri = buildPlatformRedirectUri(platform, env);
      const scopes = [
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/youtube.readonly'
      ].join(' ');

      const params = new URLSearchParams({
        client_id: env.YOUTUBE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes,
        access_type: 'offline',
        prompt: 'consent',
        state
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    case 'tiktok': {
      if (!env.TIKTOK_CLIENT_KEY) {
        throw new AppError(503, 'PLATFORM_NOT_CONFIGURED', 'TikTok OAuth is not configured. Add TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET to .env.');
      }
      const redirectUri = buildPlatformRedirectUri(platform, env);
      const params = new URLSearchParams({
        client_key: env.TIKTOK_CLIENT_KEY,
        scope: 'user.info.basic,video.upload,video.publish',
        response_type: 'code',
        redirect_uri: redirectUri,
        state
      });
      return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
    }

    case 'instagram':
    case 'facebook': {
      if (!env.META_APP_ID) {
        throw new AppError(503, 'PLATFORM_NOT_CONFIGURED', `Meta (${platform}) OAuth is not configured. Add META_APP_ID and META_APP_SECRET to .env.`);
      }
      const redirectUri = buildPlatformRedirectUri(platform, env);
      const scopes = platform === 'instagram'
        ? 'instagram_basic,instagram_content_publish,pages_show_list'
        : 'pages_show_list,pages_manage_posts,pages_read_engagement';

      const params = new URLSearchParams({
        client_id: env.META_APP_ID,
        redirect_uri: redirectUri,
        scope: scopes,
        response_type: 'code',
        state
      });
      return `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;
    }

    default:
      throw new AppError(400, 'UNSUPPORTED_PLATFORM', `Unsupported social platform: ${String(platform)}`);
  }
};

const upsertSocialConnection = async ({
  ownerId,
  platform,
  accountId,
  accountName,
  accountHandle,
  avatarUrl,
  tokens,
  scopeList,
  env
}: {
  ownerId: string;
  platform: SocialPlatform;
  accountId: string;
  accountName: string;
  accountHandle?: string;
  avatarUrl?: string;
  tokens: { accessToken: string; refreshToken?: string; expiresIn?: number };
  scopeList: string[];
  env: Env;
}): Promise<{ accountId: string; accountName: string }> => {
  const encryptionKey = getTokenEncryptionKey(env);
  const tokenExpiresAt = tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : new Date(Date.now() + 60 * 60 * 1000);

  await SocialAccountModel.findOneAndUpdate(
    { ownerId, platform, accountId },
    {
      $set: {
        ownerId,
        platform,
        accountId,
        accountName,
        accountHandle: accountHandle || undefined,
        avatarUrl: avatarUrl || undefined,
        encryptedAccessToken: encryptToken(tokens.accessToken, encryptionKey),
        ...(tokens.refreshToken ? { encryptedRefreshToken: encryptToken(tokens.refreshToken, encryptionKey) } : {}),
        tokenExpiresAt,
        scopes: scopeList.length ? scopeList : ['read', 'publish'],
        status: 'connected',
        lastError: undefined
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return { accountId, accountName };
};

export const exchangeOAuthCode = async (
  ownerId: string,
  platform: SocialPlatform | undefined,
  code: string,
  env: Env,
  state?: string
): Promise<{ accountId: string; accountName: string }> => {
  if (!state) {
    throw new AppError(400, 'MISSING_OAUTH_STATE', 'The OAuth callback is missing the signed state token.');
  }

  const resolvedPlatform = platform ?? decodeOAuthState(state, env).platform;
  if (!resolvedPlatform) {
    throw new AppError(400, 'MISSING_OAUTH_CONTEXT', 'The OAuth callback is missing the platform metadata.');
  }

  const verifiedOwnerId = verifyOAuthState(state, resolvedPlatform, env);
  if (verifiedOwnerId !== ownerId) {
    throw new AppError(403, 'OAUTH_STATE_FORBIDDEN', 'The OAuth callback does not belong to the signed-in user.');
  }

  if (platform && platform !== resolvedPlatform) {
    throw new AppError(403, 'OAUTH_STATE_MISMATCH', 'The OAuth state does not match the requested platform.');
  }

  switch (resolvedPlatform) {
    case 'youtube': {
      if (!env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET) {
        throw new AppError(503, 'PLATFORM_NOT_CONFIGURED', 'YouTube OAuth credentials not configured.');
      }

      const redirectUri = buildPlatformRedirectUri(resolvedPlatform, env);
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: env.YOUTUBE_CLIENT_ID,
          client_secret: env.YOUTUBE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code'
        }).toString()
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        throw new AppError(502, 'OAUTH_TOKEN_EXCHANGE_FAILED', `Failed to exchange token with Google: ${errText.slice(0, 200)}`);
      }

      const tokens = await tokenRes.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
      };

      const channelRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });

      let accountId = `yt_${Date.now()}`;
      let accountName = 'YouTube Channel';
      let avatarUrl = '';

      if (channelRes.ok) {
        const channelData = await channelRes.json() as {
          items?: Array<{
            id?: string;
            snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } };
          }>;
        };
        const channel = channelData.items?.[0];
        if (channel?.id) accountId = channel.id;
        if (channel?.snippet?.title) accountName = channel.snippet.title;
        if (channel?.snippet?.thumbnails?.default?.url) avatarUrl = channel.snippet.thumbnails.default.url;
      }

      return upsertSocialConnection({
        ownerId,
        platform: 'youtube',
        accountId,
        accountName,
        avatarUrl,
        tokens: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresIn: tokens.expires_in
        },
        scopeList: tokens.scope ? tokens.scope.split(' ') : ['https://www.googleapis.com/auth/youtube.upload'],
        env
      });
    }

    case 'tiktok': {
      if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) {
        throw new AppError(503, 'PLATFORM_NOT_CONFIGURED', 'TikTok OAuth credentials not configured.');
      }

      const redirectUri = buildPlatformRedirectUri(resolvedPlatform, env);
      const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_key: env.TIKTOK_CLIENT_KEY,
          client_secret: env.TIKTOK_CLIENT_SECRET,
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri
        }).toString()
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        throw new AppError(502, 'OAUTH_TOKEN_EXCHANGE_FAILED', `Failed to exchange token with TikTok: ${errText.slice(0, 220)}`);
      }

      const tokenData = await tokenRes.json() as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
        open_id?: string;
        error?: { message?: string };
      };

      if (!tokenData.access_token || tokenData.error) {
        throw new AppError(502, 'OAUTH_TOKEN_EXCHANGE_FAILED', tokenData.error?.message || 'TikTok did not return an access token.');
      }

      const profileRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,username,avatar_url', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json'
        }
      });

      let accountId = tokenData.open_id || `tt_${Date.now()}`;
      let accountName = 'TikTok Account';
      let avatarUrl = '';
      let accountHandle = '';

      if (profileRes.ok) {
        const profile = await profileRes.json() as {
          data?: {
            user?: {
              open_id?: string;
              username?: string;
              avatar_url?: string;
            };
          };
        };
        const user = profile.data?.user;
        if (user?.open_id) accountId = user.open_id;
        if (user?.username) {
          accountName = user.username;
          accountHandle = `@${user.username}`;
        }
        if (user?.avatar_url) avatarUrl = user.avatar_url;
      }

      return upsertSocialConnection({
        ownerId,
        platform: 'tiktok',
        accountId,
        accountName,
        accountHandle,
        avatarUrl,
        tokens: {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresIn: tokenData.expires_in
        },
        scopeList: tokenData.scope ? tokenData.scope.split(',') : ['user.info.basic', 'video.upload'],
        env
      });
    }

    case 'instagram':
    case 'facebook': {
      if (!env.META_APP_ID || !env.META_APP_SECRET) {
        throw new AppError(503, 'PLATFORM_NOT_CONFIGURED', `Meta (${resolvedPlatform}) OAuth credentials not configured.`);
      }

      const redirectUri = buildPlatformRedirectUri(resolvedPlatform, env);
      const tokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?client_id=${encodeURIComponent(env.META_APP_ID)}&client_secret=${encodeURIComponent(env.META_APP_SECRET)}&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(redirectUri)}&grant_type=authorization_code`);

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        throw new AppError(502, 'OAUTH_TOKEN_EXCHANGE_FAILED', `Failed to exchange token with Meta: ${errText.slice(0, 220)}`);
      }

      const tokenData = await tokenRes.json() as {
        access_token?: string;
        expires_in?: number;
        error?: { message?: string };
      };

      if (!tokenData.access_token || tokenData.error) {
        throw new AppError(502, 'OAUTH_TOKEN_EXCHANGE_FAILED', tokenData.error?.message || 'Meta did not return an access token.');
      }

      const meRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name,picture.type(square),accounts{ id,name,instagram_business_account{id,username,profile_picture_url} }&access_token=${encodeURIComponent(tokenData.access_token)}`);
      const meData = await meRes.json() as {
        id?: string;
        name?: string;
        picture?: { data?: { url?: string } };
        accounts?: { data?: Array<{ id?: string; name?: string; instagram_business_account?: { id?: string; username?: string; profile_picture_url?: string } }> };
        error?: { message?: string };
      };

      if (meData.error) {
        throw new AppError(502, 'OAUTH_PROFILE_LOOKUP_FAILED', meData.error.message || 'Meta account profile lookup failed.');
      }

      let accountId = meData.id || `meta_${Date.now()}`;
      let accountName = meData.name || `${resolvedPlatform === 'instagram' ? 'Instagram' : 'Facebook'} Account`;
      let avatarUrl = meData.picture?.data?.url || '';
      let accountHandle = '';
      let scopes = ['public_profile'];

      if (resolvedPlatform === 'instagram') {
        const pageAccount = meData.accounts?.data?.find((item) => item.instagram_business_account);
        const insta = pageAccount?.instagram_business_account;
        if (insta?.id) accountId = insta.id;
        if (insta?.username) {
          accountName = insta.username;
          accountHandle = `@${insta.username}`;
        }
        if (insta?.profile_picture_url) avatarUrl = insta.profile_picture_url;
        scopes = ['instagram_basic', 'instagram_content_publish'];
      } else {
        const pageAccount = meData.accounts?.data?.[0];
        if (pageAccount?.id) accountId = pageAccount.id;
        if (pageAccount?.name) accountName = pageAccount.name;
        scopes = ['pages_show_list', 'pages_manage_posts'];
      }

      return upsertSocialConnection({
        ownerId,
        platform: resolvedPlatform,
        accountId,
        accountName,
        accountHandle,
        avatarUrl,
        tokens: {
          accessToken: tokenData.access_token,
          expiresIn: tokenData.expires_in
        },
        scopeList: scopes,
        env
      });
    }

    default:
      throw new AppError(501, 'NOT_IMPLEMENTED', `OAuth code exchange for ${resolvedPlatform} requires platform approval.`);
  }
};

export const revokeOAuthToken = async (account: { platform: string; encryptedAccessToken?: string }, env: Env): Promise<void> => {
  const encryptionKey = getTokenEncryptionKey(env);
  if (!account.encryptedAccessToken) return;

  try {
    const token = decryptToken(account.encryptedAccessToken, encryptionKey);
    if (!token) return;

    switch (account.platform) {
      case 'youtube':
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }).toString()
        });
        break;
      case 'tiktok':
        if (env.TIKTOK_CLIENT_KEY) {
          await fetch('https://open.tiktokapis.com/v2/oauth/revoke/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ client_key: env.TIKTOK_CLIENT_KEY, token })
          });
        }
        break;
      case 'instagram':
      case 'facebook':
        if (env.META_APP_ID) {
          await fetch(`https://graph.facebook.com/v19.0/${env.META_APP_ID}/permissions?access_token=${encodeURIComponent(token)}`, { method: 'DELETE' });
        }
        break;
      default:
        break;
    }
  } catch {
    // If the token cannot be revoked, the local account should still be disconnected safely.
  }
};

export const connectSimulatedAccount = async (
  ownerId: string,
  platform: SocialPlatform,
  accountName: string,
  env: Env
): Promise<{ accountId: string; accountName: string }> => {
  const encryptionKey = getTokenEncryptionKey(env);
  const sanitizedName = accountName.trim() || `${platform.toUpperCase()} Test Channel`;
  const accountId = `sim_${platform}_${Date.now().toString(36)}`;

  const mockAvatars: Record<SocialPlatform, string> = {
    youtube: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100&auto=format&fit=crop&q=60',
    tiktok: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=100&auto=format&fit=crop&q=60',
    instagram: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100&auto=format&fit=crop&q=60',
    facebook: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=100&auto=format&fit=crop&q=60'
  };

  await SocialAccountModel.findOneAndUpdate(
    { ownerId, platform, accountId },
    {
      $set: {
        ownerId,
        platform,
        accountId,
        accountName: sanitizedName,
        accountHandle: `@${sanitizedName.toLowerCase().replace(/[^a-z0-9_]/g, '')}`,
        avatarUrl: mockAvatars[platform],
        encryptedAccessToken: encryptToken('simulated_access_token', encryptionKey),
        tokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        scopes: ['publish', 'read'],
        status: 'connected',
        lastError: undefined,
        metadata: { isSimulated: true, note: 'Connected in development test mode' }
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return { accountId, accountName: sanitizedName };
};
