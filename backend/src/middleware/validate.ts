import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

export const validate = <T>(schema: ZodType<T>) => (req: Request, _res: Response, next: NextFunction): void => {
  const result = schema.safeParse(req.body);
  if (!result.success) { next(result.error); return; }
  req.body = result.data;
  next();
};
