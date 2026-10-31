import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import type { Env } from '../config/env.js';

export const hashPassword = async (password: string): Promise<string> => bcrypt.hash(password, 12);
export const verifyPassword = async (password: string, hash: string): Promise<boolean> => bcrypt.compare(password, hash);

export const createSessionToken = (userId: string, sessionVersion: number, env: Env): string =>
  jwt.sign({ sub: userId, sv: sessionVersion, aud: 'clipforge-web' }, env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d', issuer: 'clipforge-api' });

export const verifySessionToken = (token: string, env: Env): { userId: string; sessionVersion: number } => {
  const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], audience: 'clipforge-web', issuer: 'clipforge-api' });
  if (typeof payload === 'string' || !payload.sub || typeof payload.sv !== 'number') throw new Error('Invalid session token');
  return { userId: payload.sub, sessionVersion: payload.sv };
};

export const createCsrfToken = (): string => randomBytes(32).toString('base64url');
