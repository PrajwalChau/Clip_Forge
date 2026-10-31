import type { NextFunction, Request, Response } from 'express';
import type { ZodError } from 'zod';

export class AppError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (_req: Request, _res: Response, next: NextFunction): void => {
  next(new AppError(404, 'NOT_FOUND', 'The requested resource was not found.'));
};

export const errorHandler = (err: Error & { code?: number | string; name?: string; errors?: unknown }, _req: Request, res: Response, _next: NextFunction): void => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err.name === 'ZodError') {
    const zodError = err as unknown as ZodError;
    res.status(422).json({ error: { code: 'VALIDATION_FAILED', message: 'Please correct the highlighted values.', details: zodError.issues } });
    return;
  }
  if (err.name === 'CastError') {
    res.status(400).json({ error: { code: 'INVALID_ID', message: 'One of the provided identifiers is invalid.' } });
    return;
  }
  if (err.code === 11000) {
    res.status(409).json({ error: { code: 'CONFLICT', message: 'This resource already exists.' } });
    return;
  }
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' } });
};
