import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../app.js';
import type { Env } from '../config/env.js';
import { hashPassword } from '../services/auth.js';
import type { StorageService } from '../services/storage.js';
import { ProcessingDispatcher } from '../workers/processing.js';
import { UserModel } from '../models/User.js';
import { PaymentModel } from '../models/Payment.js';
import { ProcessingJobModel } from '../models/ProcessingJob.js';
import { ProjectModel } from '../models/Project.js';
import { SubscriptionModel } from '../models/Subscription.js';
import { VideoAssetModel } from '../models/VideoAsset.js';
import { UsageModel } from '../models/Usage.js';
import { reserveProcessing } from '../services/quota.js';

const env: Env = {
  NODE_ENV: 'test', PORT: 4000, MONGODB_URI: '', JWT_SECRET: 'integration-test-secret-must-be-at-least-thirty-two-characters', COOKIE_SECURE: false, FRONTEND_URL: 'http://localhost:5173', QUEUE_MODE: 'inline', WORKER_MODE: 'embedded', WORKER_CONCURRENCY: 1, STORAGE_PROVIDER: 'local', LOCAL_STORAGE_PATH: './test-storage', MAX_UPLOAD_BYTES: 1000, MAX_VIDEO_DURATION_SECONDS: 600, MAX_OUTPUT_BYTES: 1000, MAX_CLIPS_PER_JOB: 5, TEMP_FILE_MAX_AGE_HOURS: 24, FFMPEG_PATH: 'ffmpeg', FFPROBE_PATH: 'ffprobe', WHISPER_COMMAND: 'whisper', WHISPER_MODEL: 'base', TRANSCRIPTION_PROVIDER: 'none', AI_PROVIDER: 'none', GEMINI_MODEL: 'gemini-2.5-flash', VIDEO_PROCESSING_MODE: 'real', PAYMENTS_MODE: 'disabled'
};
const storage: StorageService = {
  putFromPath: async (objectKey) => ({ objectKey, sizeBytes: 0 }),
  copyToPath: async () => undefined,
  signedDownloadUrl: async () => 'http://example.test/download',
  delete: async () => undefined
};

let mongo: MongoMemoryServer | undefined;
let app: ReturnType<typeof createApp>;

const csrfFrom = (cookies: string[] | undefined): string => {
  const cookie = cookies?.find((item) => item.startsWith('clipforge_csrf='));
  const firstPart = cookie?.split(';')[0];
  const value = firstPart?.split('=').slice(1).join('=');
  if (!value) throw new Error('CSRF cookie missing from auth response');
  return decodeURIComponent(value);
};

const cookieHeaderFrom = (cookies: string[] | undefined): string => cookies?.map((cookie) => cookie.split(';')[0]).join('; ') ?? '';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const dispatcher = new ProcessingDispatcher(env, storage);
  app = createApp(env, storage, dispatcher);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('registration, login, logout, and role boundaries', () => {
  it('creates an ordinary Free user, hashes the password, rejects a duplicate, and restores a session', async () => {
    const agent = request.agent(app);
    const register = await agent.post('/api/v1/auth/register').send({ name: 'Creator', email: 'CREATOR@example.com', password: 'a-safe-long-password', role: 'admin', plan: 'premium' }).expect(201);
    expect(register.body.user).toMatchObject({ email: 'creator@example.com', role: 'user', accountStatus: 'active', plan: 'free' });
    const stored = await UserModel.findOne({ email: 'creator@example.com' }).select('+passwordHash').lean();
    expect(stored?.passwordHash).not.toBe('a-safe-long-password');
    expect(stored?.passwordHash.startsWith('$2')).toBe(true);
    await agent.get('/api/v1/auth/me').expect(200).expect((response) => expect(response.body.user.email).toBe('creator@example.com'));
    await request(app).post('/api/v1/auth/register').send({ name: 'Creator Two', email: 'creator@example.com', password: 'another-safe-password' }).expect(409);
  });

  it('uses generic login errors and invalidates a captured session on CSRF-protected logout', async () => {
    const agent = request.agent(app);
    await agent.post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'wrong-password' }).expect(401).expect((response) => expect(response.body.error.code).toBe('INVALID_CREDENTIALS'));
    const login = await agent.post('/api/v1/auth/login').send({ email: 'creator@example.com', password: 'a-safe-long-password' }).expect(200);
    const cookies = login.headers['set-cookie'] as string[] | undefined;
    const cookieHeader = cookieHeaderFrom(cookies);
    const csrf = csrfFrom(cookies);
    await request(app).get('/api/v1/auth/me').set('Cookie', cookieHeader).expect(200);
    await request(app).get('/api/v1/auth/me').set('Cookie', 'clipforge_session=not-a-valid-session').expect(401);
    await request(app).patch('/api/v1/auth/me').set('Cookie', cookieHeader).send({ name: 'Updated Creator', role: 'admin', plan: 'premium' }).expect(403);
    await request(app).patch('/api/v1/auth/me').set('Cookie', cookieHeader).set('x-csrf-token', csrf).send({ name: 'Updated Creator', role: 'admin', plan: 'premium' }).expect(200).expect((response) => expect(response.body.user).toMatchObject({ name: 'Updated Creator', role: 'user', plan: 'free' }));
    await request(app).post('/api/v1/auth/logout').set('Cookie', cookieHeader).expect(403);
    await request(app).post('/api/v1/auth/logout').set('Cookie', cookieHeader).set('x-csrf-token', csrf).expect(204);
    await request(app).get('/api/v1/auth/me').set('Cookie', cookieHeader).expect(401);
  });

  it('denies ordinary users from every admin surface and logs suspension by an administrator', async () => {
    const admin = await UserModel.create({ name: 'Operator', email: 'admin@example.com', passwordHash: await hashPassword('administrator-password'), role: 'admin' });
    const normal = await UserModel.create({ name: 'Member', email: 'member@example.com', passwordHash: await hashPassword('member-password') });
    const project = await ProjectModel.create({ ownerId: normal.id, title: 'Customer interview' });
    const asset = await VideoAssetModel.create({ ownerId: normal.id, projectId: project.id, kind: 'source', originalFilename: 'interview.mp4', mimeType: 'video/mp4', sizeBytes: 4096, durationSeconds: 60, storageProvider: 'local', objectKey: 'test/member/interview.mp4', state: 'uploaded' });
    const subscription = await SubscriptionModel.create({ ownerId: normal.id, plan: 'pro', status: 'active', provider: 'test', providerReference: 'sub-test-member', currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 24 * 60 * 60 * 1000) });
    await PaymentModel.create({ ownerId: normal.id, subscriptionId: subscription.id, provider: 'test', providerReference: 'payment-test-member', amountPaisa: 49900, status: 'verified', verifiedAt: new Date() });
    await ProcessingJobModel.create({ ownerId: normal.id, projectId: project.id, sourceAssetId: asset.id, status: 'failed', step: 'finalizing', progress: 100, errorCode: 'TEST_PROCESSING_FAILURE' });
    const normalLogin = await request(app).post('/api/v1/auth/login').send({ email: normal.email, password: 'member-password' }).expect(200);
    const normalCookies = cookieHeaderFrom(normalLogin.headers['set-cookie'] as string[] | undefined);
    const normalCsrf = csrfFrom(normalLogin.headers['set-cookie'] as string[] | undefined);
    await Promise.all([
      '/overview', '/users', `/users/${normal.id}`, '/projects', '/jobs', '/clips', '/storage/overview', '/plans', '/subscriptions', '/payments', '/health', '/audit-logs'
    ].map((path) => request(app).get(`/api/v1/admin${path}`).set('Cookie', normalCookies).expect(403)));
    await request(app).patch(`/api/v1/admin/users/${admin.id}/status`).set('Cookie', normalCookies).set('x-csrf-token', normalCsrf).send({ status: 'suspended', reason: 'Not authorized' }).expect(403);
    const login = await request(app).post('/api/v1/auth/login').send({ email: admin.email, password: 'administrator-password' }).expect(200);
    const loginCookies = login.headers['set-cookie'] as string[] | undefined;
    const cookieHeader = cookieHeaderFrom(loginCookies);
    const csrf = csrfFrom(loginCookies);
    await request(app).get('/api/v1/admin/users?page=1&limit=1').set('Cookie', cookieHeader).expect(200).expect((response) => { expect(response.body.pagination.total).toBeGreaterThanOrEqual(3); expect(response.body.users).toHaveLength(1); });
    await request(app).get('/api/v1/admin/users?search=member%40example.com&page=1&limit=20').set('Cookie', cookieHeader).expect(200).expect((response) => expect(response.body.users).toMatchObject([{ email: 'member@example.com', role: 'user' }]));
    await request(app).get('/api/v1/admin/overview').set('Cookie', cookieHeader).expect(200).expect((response) => expect(response.body).toMatchObject({ metrics: { activeSubscriptions: 1, verifiedRevenuePaisa: 49900, totalStoredBytes: 4096 }, jobs: { failed: 1 } }));
    await request(app).patch(`/api/v1/admin/users/${normal.id}/status`).set('Cookie', cookieHeader).set('x-csrf-token', csrf).send({ status: 'suspended', reason: 'Repeated policy violation' }).expect(200);
    await request(app).post('/api/v1/auth/login').send({ email: normal.email, password: 'member-password' }).expect(401);
    await request(app).patch(`/api/v1/admin/users/${normal.id}/status`).set('Cookie', cookieHeader).set('x-csrf-token', csrf).send({ status: 'active' }).expect(200);
    await request(app).post('/api/v1/auth/login').send({ email: normal.email, password: 'member-password' }).expect(200);
    await request(app).patch(`/api/v1/admin/users/${admin.id}/status`).set('Cookie', cookieHeader).set('x-csrf-token', csrf).send({ status: 'suspended', reason: 'Self lockout check' }).expect(409);
    await request(app).get('/api/v1/admin/audit-logs').set('Cookie', cookieHeader).expect(200).expect((response) => { expect(response.body.logs.some((entry: { action: string; targetId: string }) => entry.action === 'user.suspend' && entry.targetId === normal.id)).toBe(true); expect(response.body.logs.some((entry: { action: string; targetId: string }) => entry.action === 'user.reactivate' && entry.targetId === normal.id)).toBe(true); });
  });
});

describe('processing entitlements', () => {
  it('enforces the Free clip allowance while allowing administrator clip reservations to exceed paid-plan limits', async () => {
    const member = await UserModel.create({ name: 'Quota Member', email: 'quota-member@example.com', passwordHash: await hashPassword('quota-member-password') });
    const administrator = await UserModel.create({ name: 'Quota Administrator', email: 'quota-admin@example.com', passwordHash: await hashPassword('quota-admin-password'), role: 'admin', plan: 'premium' });

    await reserveProcessing(member.id, member.plan, 60, 15, member.role);
    await expect(reserveProcessing(member.id, member.plan, 60, 1, member.role)).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });

    await reserveProcessing(administrator.id, administrator.plan, 60, 101, administrator.role);
    const adminUsage = await UsageModel.findOne({ ownerId: administrator.id }).lean();
    expect(adminUsage?.reservedGeneratedClips).toBe(101);
  });
});
