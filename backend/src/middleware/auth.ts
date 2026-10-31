import type { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import type { Env } from '../config/env.js';
import { UserModel } from '../models/User.js';
import { verifySessionToken } from '../services/auth.js';
import { AppError } from '../utils/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: { userId: string; role: 'user' | 'admin' };
  }
}

export const requireAuth = (env: Env) => async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = req.cookies?.clipforge_session as string | undefined;
    if (!token) throw new AppError(401, 'AUTH_REQUIRED', 'Please sign in to continue.');
    const session = verifySessionToken(token, env);
    if (!Types.ObjectId.isValid(session.userId)) {
      throw new AppError(401, 'SESSION_INVALID', 'Your session has expired. Please sign in again.');
    }
    const user = await UserModel.findById(session.userId).select('+sessionVersion role accountStatus').lean();
    if (!user || user.accountStatus !== 'active' || user.sessionVersion !== session.sessionVersion) throw new AppError(401, 'SESSION_INVALID', 'Your session has expired. Please sign in again.');
    req.auth = { userId: String(user._id), role: user.role };
    next();
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(401, 'SESSION_INVALID', 'Your session has expired. Please sign in again.'));
  }
};

export const authUserId = (req: Request): string => {
  if (!req.auth) throw new AppError(401, 'AUTH_REQUIRED', 'Please sign in to continue.');
  return req.auth.userId;
};

export const requireAdmin = (req: Request, _res: Response, next: NextFunction): void => {
  if (req.auth?.role !== 'admin') { next(new AppError(403, 'ADMIN_REQUIRED', 'Administrator access is required for this action.')); return; }
  next();
};
