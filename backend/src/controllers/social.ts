import { z } from 'zod';
import type { Request, Response } from 'express';
import type { Env } from '../config/env.js';
import { authUserId } from '../middleware/auth.js';
import { SocialAccountModel } from '../models/SocialAccount.js';
import {
  connectSimulatedAccount,
  createOAuthState,
  exchangeOAuthCode,
  getOAuthAuthorizationUrl,
  getPlatformConfigStatus,
  revokeOAuthToken
} from '../services/social/oauth.js';
import { PLATFORM_SPECS } from '../services/social/types.js';
import { AppError } from '../utils/errors.js';

const platformSchema = z.enum(['youtube', 'tiktok', 'instagram', 'facebook']);

const oauthUrlSchema = z.object({
  platform: platformSchema,
  state: z.string().optional()
});

const exchangeSchema = z.object({
  platform: platformSchema.optional(),
  code: z.string().min(1, 'Authorization code is required'),
  state: z.string().min(1, 'OAuth state is required').optional()
});

const simulatedSchema = z.object({
  platform: platformSchema,
  accountName: z.string().trim().max(100).default('')
});

export const listAccounts = async (req: Request, res: Response): Promise<void> => {
  const ownerId = authUserId(req);
  const accounts = await SocialAccountModel.find({
    ownerId,
    status: { $ne: 'disconnected' }
  })
    .select('_id platform accountId accountName accountHandle avatarUrl status lastError scopes tokenExpiresAt createdAt updatedAt metadata')
    .sort({ createdAt: -1 })
    .lean();

  res.json({ accounts });
};

export const getPlatforms = (env: Env) => (_req: Request, res: Response): void => {
  const status = getPlatformConfigStatus(env);
  res.json({
    platforms: Object.values(status).map((p) => ({
      ...p,
      spec: PLATFORM_SPECS[p.platform]
    }))
  });
};

export const getOAuthUrl = (env: Env) => async (req: Request, res: Response): Promise<void> => {
  const { platform, state } = oauthUrlSchema.parse({
    ...req.query,
    ...req.body,
    platform: req.query.platform ?? req.body?.platform
  });
  const ownerId = authUserId(req);
  const authState = state || createOAuthState(ownerId, platform, env);
  const url = getOAuthAuthorizationUrl(platform, authState, env);
  res.json({ url });
};

export const handleCallback = (env: Env) => async (req: Request, res: Response): Promise<void> => {
  const ownerId = authUserId(req);
  const input = exchangeSchema.parse({
    ...req.query,
    ...req.body,
    code: req.query.code ?? req.body?.code,
    state: req.query.state ?? req.body?.state,
    platform: req.query.platform ?? req.body?.platform
  });
  const result = await exchangeOAuthCode(ownerId, input.platform, input.code, env, input.state);
  res.json({
    success: true,
    message: `Successfully connected ${result.accountName}`,
    account: result
  });
};

export const disconnectAccount = (env: Env) => async (req: Request, res: Response): Promise<void> => {
  const ownerId = authUserId(req);
  const { accountId } = req.params;

  const account = await SocialAccountModel.findOne({ _id: accountId, ownerId }).select('+encryptedAccessToken').lean();
  if (!account) {
    throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'This social account was not found.');
  }

  await revokeOAuthToken(account, env);

  const updated = await SocialAccountModel.findOneAndUpdate(
    { _id: accountId, ownerId },
    { $set: { status: 'disconnected', encryptedAccessToken: '', encryptedRefreshToken: '' } },
    { new: true }
  );

  if (!updated) {
    throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'This social account was not found.');
  }

  res.json({ success: true, message: 'Account disconnected successfully.' });
};

export const connectSimulated = (env: Env) => async (req: Request, res: Response): Promise<void> => {
  const ownerId = authUserId(req);
  const { platform, accountName } = simulatedSchema.parse(req.body);
  const result = await connectSimulatedAccount(ownerId, platform, accountName, env);
  res.status(201).json({
    success: true,
    message: `Connected test account "${result.accountName}" for ${platform}.`,
    account: result
  });
};
