import type { Request, Response } from 'express';
import { z } from 'zod';
import { authUserId } from '../middleware/auth.js';
import { ProcessingJobModel } from '../models/ProcessingJob.js';
import { AppError } from '../utils/errors.js';

const listJobsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

export const listJobs = async (req: Request, res: Response): Promise<void> => {
  const ownerId = authUserId(req);
  const { page, limit } = listJobsQuery.parse(req.query);
  const [jobs, total] = await Promise.all([
    ProcessingJobModel.find({ ownerId }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ProcessingJobModel.countDocuments({ ownerId })
  ]);
  res.json({ jobs, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
};

export const getJob = async (req: Request, res: Response): Promise<void> => {
  const job = await ProcessingJobModel.findOne({ _id: req.params.jobId, ownerId: authUserId(req) }).lean();
  if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'This processing job was not found.');
  res.json({ job });
};
