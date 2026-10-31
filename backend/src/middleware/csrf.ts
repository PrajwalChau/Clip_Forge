import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../utils/errors.js';

export const requireCsrf = (req: Request, _res: Response, next: NextFunction): void => {
  const cookieToken = req.cookies?.clipforge_csrf as string | undefined;
  const headerToken = req.get('x-csrf-token');
  if (!cookieToken || !headerToken) { next(new AppError(403, 'CSRF_INVALID', 'This request could not be verified. Refresh the page and try again.')); return; }
  const left = Buffer.from(cookieToken);
  const right = Buffer.from(headerToken);
  if (left.length !== right.length || !timingSafeEqual(left, right)) { next(new AppError(403, 'CSRF_INVALID', 'This request could not be verified. Refresh the page and try again.')); return; }
  next();
};
