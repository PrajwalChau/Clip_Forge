import { Schema, model, type InferSchemaType } from 'mongoose';

const subscriptionSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  plan: { type: String, enum: ['free', 'pro', 'premium'], required: true },
  status: { type: String, enum: ['active', 'pending', 'cancelled', 'expired'], required: true, index: true },
  provider: { type: String, enum: ['esewa', 'khalti', 'test'], required: true },
  providerReference: { type: String, required: true, unique: true },
  currentPeriodStart: { type: Date, required: true },
  currentPeriodEnd: { type: Date, required: true },
  cancelAtPeriodEnd: { type: Boolean, default: false }
}, { timestamps: true });

subscriptionSchema.index({ ownerId: 1, status: 1, currentPeriodEnd: -1 });
export type Subscription = InferSchemaType<typeof subscriptionSchema>;
export const SubscriptionModel = model('Subscription', subscriptionSchema);
