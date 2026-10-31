import { Schema, model, type InferSchemaType } from 'mongoose';

const socialAccountSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  platform: {
    type: String,
    enum: ['youtube', 'tiktok', 'instagram', 'facebook'],
    required: true,
    index: true
  },
  accountId: { type: String, required: true, maxlength: 255 },
  accountName: { type: String, required: true, trim: true, maxlength: 255 },
  accountHandle: { type: String, trim: true, maxlength: 255 },
  avatarUrl: { type: String, maxlength: 2048 },
  encryptedAccessToken: { type: String, required: true, select: false },
  encryptedRefreshToken: { type: String, select: false },
  tokenExpiresAt: { type: Date },
  scopes: [{ type: String, maxlength: 255 }],
  status: {
    type: String,
    enum: ['connected', 'expired', 'disconnected', 'error'],
    default: 'connected',
    index: true
  },
  lastError: { type: String, maxlength: 1000 },
  metadata: { type: Schema.Types.Mixed }
}, { timestamps: true });

socialAccountSchema.index({ ownerId: 1, platform: 1, accountId: 1 }, { unique: true });
socialAccountSchema.index({ ownerId: 1, status: 1 });

export type SocialAccount = InferSchemaType<typeof socialAccountSchema>;
export const SocialAccountModel = model('SocialAccount', socialAccountSchema);
