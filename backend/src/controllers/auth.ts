import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { UserModel } from '../models/User.js';
import { createCsrfToken, createSessionToken, hashPassword, verifyPassword } from '../services/auth.js';
import { AppError } from '../utils/errors.js';
import { authUserId } from '../middleware/auth.js';

export const registerSchema = z.object({ name: z.string().trim().min(1).max(100), email: z.string().trim().email().max(254), password: z.string().min(12).max(200) });
export const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(200) });
export const updateUserSchema = z.object({ name: z.string().trim().min(1).max(100) });

const safeUser = (user: { id?: string; _id?: unknown; email: string; name: string; plan: string; role: 'user' | 'admin'; accountStatus: 'active' | 'suspended'; createdAt?: Date; updatedAt?: Date }) => ({ id: user.id ?? String(user._id), email: user.email, name: user.name, plan: user.plan, role: user.role, accountStatus: user.accountStatus, createdAt: user.createdAt, updatedAt: user.updatedAt });
const cookieBaseOptions = (env: Env) => ({ secure: env.COOKIE_SECURE, sameSite: 'lax' as const, path: '/' });
const cookieOptions = (env: Env) => ({ ...cookieBaseOptions(env), httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
const csrfCookieOptions = (env: Env) => ({ ...cookieBaseOptions(env), httpOnly: false, maxAge: 7 * 24 * 60 * 60 * 1000 });
const clearSessionCookieOptions = (env: Env) => ({ ...cookieBaseOptions(env), httpOnly: true });
const clearCsrfCookieOptions = (env: Env) => ({ ...cookieBaseOptions(env), httpOnly: false });

const setSessionCookies = (res: Response, user: { id: string; sessionVersion: number }, env: Env): Response => res
  .cookie('clipforge_session', createSessionToken(user.id, user.sessionVersion, env), cookieOptions(env))
  .cookie('clipforge_csrf', createCsrfToken(), csrfCookieOptions(env));

export const register = (env: Env) => async (req: Request, res: Response): Promise<void> => {
  const input = registerSchema.parse(req.body);
  const email = input.email.toLowerCase();
  if (await UserModel.exists({ email })) throw new AppError(409, 'EMAIL_IN_USE', 'An account with that email already exists.');
  const user = await UserModel.create({ email, name: input.name, passwordHash: await hashPassword(input.password) });
  setSessionCookies(res.status(201), { id: String(user._id), sessionVersion: user.sessionVersion }, env).json({ user: safeUser(user) });
};

export const login = (env: Env) => async (req: Request, res: Response): Promise<void> => {
  const input = loginSchema.parse(req.body);
  const user = await UserModel.findOne({ email: input.email.toLowerCase() }).select('+passwordHash +sessionVersion');
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  if (user.accountStatus !== 'active') throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  user.lastLoginAt = new Date();
  await user.save();
  setSessionCookies(res, { id: String(user._id), sessionVersion: user.sessionVersion }, env).json({ user: safeUser(user) });
};

export const logout = (env: Env) => async (req: Request, res: Response): Promise<void> => {
  await UserModel.updateOne({ _id: authUserId(req) }, { $inc: { sessionVersion: 1 } });
  res.clearCookie('clipforge_session', clearSessionCookieOptions(env)).clearCookie('clipforge_csrf', clearCsrfCookieOptions(env)).status(204).send();
};
export const currentUser = async (req: Request, res: Response): Promise<void> => {
  const user = await UserModel.findById(authUserId(req));
  if (!user) throw new AppError(401, 'SESSION_INVALID', 'Your session has expired. Please sign in again.');
  res.json({ user: safeUser(user) });
};
export const updateCurrentUser = async (req: Request, res: Response): Promise<void> => {
  const input = updateUserSchema.parse(req.body);
  const user = await UserModel.findByIdAndUpdate(authUserId(req), { $set: input }, { new: true });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Your account was not found.');
  res.json({ user: safeUser(user) });
};
