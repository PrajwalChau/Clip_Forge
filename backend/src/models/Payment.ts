import { Schema, model, type InferSchemaType } from 'mongoose';

const paymentSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  subscriptionId: { type: Schema.Types.ObjectId, ref: 'Subscription' },
  provider: { type: String, enum: ['esewa', 'khalti', 'test'], required: true },
  providerReference: { type: String, required: true, unique: true },
  amountPaisa: { type: Number, required: true, min: 0 },
  currency: { type: String, enum: ['NPR'], default: 'NPR' },
  status: { type: String, enum: ['pending', 'verified', 'failed', 'cancelled'], required: true, index: true },
  verifiedAt: { type: Date },
  rawEventHash: { type: String, unique: true, sparse: true }
}, { timestamps: true });

paymentSchema.index({ ownerId: 1, createdAt: -1 });
export type Payment = InferSchemaType<typeof paymentSchema>;
export const PaymentModel = model('Payment', paymentSchema);
