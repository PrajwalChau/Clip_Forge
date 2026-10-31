import { Schema, model, type InferSchemaType } from 'mongoose';

const scheduledPostSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  clipId: { type: Schema.Types.ObjectId, ref: 'Clip', required: true, index: true },
  socialAccountId: { type: Schema.Types.ObjectId, ref: 'SocialAccount', required: true, index: true },
  platform: {
    type: String,
    enum: ['youtube', 'tiktok', 'instagram', 'facebook'],
    required: true,
    index: true
  },
  caption: { type: String, trim: true, maxlength: 2200, default: '' },
  tags: [{ type: String, maxlength: 100 }],
  privacy: {
    type: String,
    enum: ['public', 'unlisted', 'private'],
    default: 'public'
  },
  scheduledFor: { type: Date, required: true, index: true },
  timezone: { type: String, default: 'UTC', maxlength: 100 },
  status: {
    type: String,
    enum: ['scheduled', 'publishing', 'published', 'failed', 'cancelled'],
    default: 'scheduled',
    index: true
  },
  publishedAt: { type: Date },
  platformPostId: { type: String, maxlength: 255 },
  platformPostUrl: { type: String, maxlength: 2048 },
  failureReason: { type: String, maxlength: 2000 },
  attempts: { type: Number, default: 0, min: 0 },
  maxAttempts: { type: Number, default: 3, min: 1 },
  jobId: { type: String, sparse: true }
}, { timestamps: true });

scheduledPostSchema.index({ ownerId: 1, scheduledFor: -1 });
scheduledPostSchema.index({ status: 1, scheduledFor: 1 });

export type ScheduledPost = InferSchemaType<typeof scheduledPostSchema>;
export const ScheduledPostModel = model('ScheduledPost', scheduledPostSchema);
