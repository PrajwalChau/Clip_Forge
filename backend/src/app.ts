import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Env } from './config/env.js';
import * as authController from './controllers/auth.js';
import * as adminController from './controllers/admin.js';
import * as billingController from './controllers/billing.js';
import * as clipsController from './controllers/clips.js';
import * as jobsController from './controllers/jobs.js';
import * as projectsController from './controllers/projects.js';
import * as storageController from './controllers/storage.js';
import * as youtubeController from './controllers/youtube.js';
import * as socialController from './controllers/social.js';
import * as publishingController from './controllers/publishing.js';
import { requireAdmin, requireAuth } from './middleware/auth.js';
import { requireCsrf } from './middleware/csrf.js';
import { asyncHandler } from './utils/async.js';
import { errorHandler, notFound } from './utils/errors.js';
import type { StorageService } from './services/storage.js';
import type { ProcessingDispatcher } from './workers/processing.js';
import { PublishingDispatcher } from './workers/publishing.js';

export const createApp = (
  env: Env,
  storage: StorageService,
  dispatcher: ProcessingDispatcher,
  publishingDispatcher = new PublishingDispatcher(env, storage)
): express.Express => {
  const app = express();
  app.disable('x-powered-by');
  app.use(pinoHttp({ redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers.x-csrf-token', 'res.headers.set-cookie'] }));
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: env.FRONTEND_URL, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'] }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));

  app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok', service: 'clipforge-api' }));

  const auth = express.Router();
  auth.post('/register', rateLimit({ windowMs: 60 * 60 * 1000, limit: 10 }), asyncHandler(authController.register(env)));
  auth.post('/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true }), asyncHandler(authController.login(env)));
  auth.post('/logout', requireAuth(env), requireCsrf, asyncHandler(authController.logout(env)));
  auth.get('/me', requireAuth(env), asyncHandler(authController.currentUser));
  auth.patch('/me', requireAuth(env), requireCsrf, asyncHandler(authController.updateCurrentUser));
  app.use('/api/v1/auth', auth);

  const protectedApi = express.Router();
  protectedApi.use(requireAuth(env));
  protectedApi.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { next(); return; }
    requireCsrf(req, res, next);
  });
  protectedApi.get('/projects', asyncHandler(projectsController.listProjects));
  protectedApi.post('/projects', asyncHandler(projectsController.createProject));
  protectedApi.get('/projects/:projectId', asyncHandler(projectsController.getProject));
  protectedApi.post('/projects/:projectId/process', asyncHandler(projectsController.startProcessing(dispatcher)));
  protectedApi.get('/jobs', asyncHandler(jobsController.listJobs));
  protectedApi.get('/jobs/:jobId', asyncHandler(jobsController.getJob));
  protectedApi.post('/jobs/:jobId/cancel', asyncHandler(projectsController.cancelProcessing));

  protectedApi.post('/storage/upload', storageController.videoUpload(env).single('file'), asyncHandler(storageController.uploadVideo(env, storage)));
  protectedApi.get('/storage/usage', asyncHandler(storageController.storageUsage));
  protectedApi.get('/storage/files', asyncHandler(storageController.listFiles));
  protectedApi.post('/storage/download-url', asyncHandler(storageController.getDownloadUrl(storage)));
  protectedApi.get('/storage/local/:objectKey', asyncHandler(storageController.serveLocalFile(storage)));
  protectedApi.delete('/storage/files/:assetId', asyncHandler(storageController.deleteFile(storage)));

  protectedApi.get('/clips', asyncHandler(clipsController.listClips));
  protectedApi.get('/clips/:clipId', asyncHandler(clipsController.getClip));
  protectedApi.patch('/clips/:clipId', asyncHandler(clipsController.updateClip));
  protectedApi.post('/clips/:clipId/download-url', asyncHandler(clipsController.downloadClip(storage)));
  protectedApi.delete('/clips/:clipId', asyncHandler(clipsController.deleteClip(storage)));

  protectedApi.get('/plans', billingController.listPlans);
  protectedApi.get('/subscriptions/me', asyncHandler(billingController.subscription));
  protectedApi.get('/billing/history', asyncHandler(billingController.paymentHistory));
  protectedApi.post('/billing/checkout', asyncHandler(billingController.beginCheckout(env)));
  protectedApi.post('/billing/test/verify', asyncHandler(billingController.verifyTestPayment(env)));

  // YouTube link ingestion & transcript analysis
  protectedApi.post('/youtube/inspect', asyncHandler(youtubeController.inspect(env)));
  protectedApi.post('/youtube/analyze-transcript', asyncHandler(youtubeController.analyzeTranscript(env)));

  // Social accounts
  protectedApi.get('/social/accounts', asyncHandler(socialController.listAccounts));
  protectedApi.get('/social/platforms', socialController.getPlatforms(env));
  protectedApi.get('/social/oauth/url', asyncHandler(socialController.getOAuthUrl(env)));
  protectedApi.post('/social/oauth/callback', asyncHandler(socialController.handleCallback(env)));
  protectedApi.delete('/social/accounts/:accountId', asyncHandler(socialController.disconnectAccount(env)));
  protectedApi.post('/social/accounts/connect-simulated', asyncHandler(socialController.connectSimulated(env)));

  // Publishing & Scheduling
  protectedApi.get('/publishing/posts', asyncHandler(publishingController.listPosts));
  protectedApi.post('/publishing/schedule', asyncHandler(publishingController.schedulePost(publishingDispatcher)));
  protectedApi.post('/publishing/posts/:postId/cancel', asyncHandler(publishingController.cancelPost(publishingDispatcher)));
  protectedApi.post('/publishing/posts/:postId/retry', asyncHandler(publishingController.retryPost(publishingDispatcher)));
  protectedApi.post('/publishing/verify-media', asyncHandler(publishingController.verifyMedia));

  const admin = express.Router();
  admin.use(requireAdmin);
  admin.get('/overview', asyncHandler(adminController.overview));
  admin.get('/users', asyncHandler(adminController.listUsers));
  admin.get('/users/:userId', asyncHandler(adminController.getUser));
  admin.patch('/users/:userId/status', asyncHandler(adminController.updateUserStatus));
  admin.get('/projects', asyncHandler(adminController.listProjects));
  admin.get('/jobs', asyncHandler(adminController.listJobs));
  admin.post('/jobs/:jobId/retry', asyncHandler(adminController.retryJob(dispatcher)));
  admin.post('/jobs/:jobId/cancel', asyncHandler(adminController.cancelJob));
  admin.get('/clips', asyncHandler(adminController.listClips));
  admin.get('/storage/overview', asyncHandler(adminController.storageOverview));
  admin.get('/plans', adminController.plans);
  admin.get('/subscriptions', asyncHandler(adminController.listSubscriptions));
  admin.get('/payments', asyncHandler(adminController.listPayments));
  admin.get('/health', asyncHandler(adminController.health(env, dispatcher)));
  admin.get('/audit-logs', asyncHandler(adminController.auditLogs));
  protectedApi.use('/admin', admin);
  app.use('/api/v1', protectedApi);

  app.use(notFound);
  app.use(errorHandler);
  return app;
};
