import { createHash, randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { authUserId } from '../middleware/auth.js';
import { PaymentModel } from '../models/Payment.js';
import { SubscriptionModel } from '../models/Subscription.js';
import { UserModel } from '../models/User.js';
import { getPlan, PLANS, type PlanName } from '../services/plans.js';
import { AppError } from '../utils/errors.js';

const checkoutSchema = z.object({ plan: z.enum(['pro', 'premium']), provider: z.enum(['esewa', 'khalti']) });
const verifyTestPaymentSchema = z.object({ paymentId: z.string().min(1), succeed: z.literal(true) });

export const listPlans = (_req: Request, res: Response): void => { res.json({ plans: Object.values(PLANS) }); };

export const subscription = async (req: Request, res: Response): Promise<void> => {
  const ownerId = authUserId(req);
  const [user, activeSubscription] = await Promise.all([UserModel.findById(ownerId).lean(), SubscriptionModel.findOne({ ownerId, status: 'active', currentPeriodEnd: { $gt: new Date() } }).sort({ currentPeriodEnd: -1 }).lean()]);
  if (!user) throw new AppError(401, 'SESSION_INVALID', 'Your session has expired. Please sign in again.');
  res.json({ plan: getPlan(user.plan), subscription: activeSubscription ?? null });
};

export const paymentHistory = async (req: Request, res: Response): Promise<void> => {
  const payments = await PaymentModel.find({ ownerId: authUserId(req) }).sort({ createdAt: -1 }).lean();
  res.json({ payments });
};

export const beginCheckout = (env: Env) => async (req: Request, res: Response): Promise<void> => {
  const ownerId = authUserId(req);
  const input = checkoutSchema.parse(req.body);
  if (env.PAYMENTS_MODE === 'disabled') throw new AppError(503, 'BILLING_NOT_CONFIGURED', 'Payments are not configured. No charge or plan upgrade has been started.');
  if (env.PAYMENTS_MODE === 'live') throw new AppError(501, 'LIVE_PROVIDER_PENDING', 'Live provider checkout requires an approved merchant integration and has not been enabled in this build.');
  const plan = getPlan(input.plan);
  const reference = `test_${randomUUID()}`;
  const payment = await PaymentModel.create({ ownerId, provider: 'test', providerReference: reference, amountPaisa: plan.priceNpr * 100, status: 'pending' });
  res.status(201).json({ payment, mode: 'test', message: 'Test mode created a pending payment only. It will not activate a subscription until server-side verification succeeds.' });
};

export const verifyTestPayment = (env: Env) => async (req: Request, res: Response): Promise<void> => {
  if (env.PAYMENTS_MODE !== 'test') throw new AppError(404, 'TEST_PAYMENT_DISABLED', 'The test payment adapter is disabled.');
  const input = verifyTestPaymentSchema.parse(req.body);
  const ownerId = authUserId(req);
  const payment = await PaymentModel.findOne({ _id: input.paymentId, ownerId, status: 'pending', provider: 'test' });
  if (!payment) throw new AppError(404, 'PAYMENT_NOT_PENDING', 'This pending test payment was not found.');
  const planName = payment.amountPaisa === PLANS.pro.priceNpr * 100 ? 'pro' : payment.amountPaisa === PLANS.premium.priceNpr * 100 ? 'premium' : null;
  if (!planName) throw new AppError(422, 'PAYMENT_AMOUNT_INVALID', 'The recorded payment amount is not valid for an available plan.');
  const verifiedAt = new Date();
  const periodEnd = new Date(verifiedAt);
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
  const eventHash = createHash('sha256').update(`${payment.id}:${verifiedAt.toISOString()}`).digest('hex');
  const sub = await SubscriptionModel.create({ ownerId, plan: planName as PlanName, status: 'active', provider: 'test', providerReference: payment.providerReference, currentPeriodStart: verifiedAt, currentPeriodEnd: periodEnd });
  payment.status = 'verified';
  payment.verifiedAt = verifiedAt;
  payment.subscriptionId = sub._id;
  payment.rawEventHash = eventHash;
  await Promise.all([payment.save(), UserModel.updateOne({ _id: ownerId }, { $set: { plan: planName } })]);
  res.json({ payment, subscription: sub, message: 'Test payment verified server-side. This transaction is labelled test data and is not a real charge.' });
};
