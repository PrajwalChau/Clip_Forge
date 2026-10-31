import { Schema, model, type InferSchemaType } from 'mongoose';

const clipSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  jobId: { type: Schema.Types.ObjectId, ref: 'ProcessingJob', index: true },
  assetId: { type: Schema.Types.ObjectId, ref: 'VideoAsset' },
  startSeconds: { type: Number, required: true, min: 0 },
  endSeconds: { type: Number, required: true, min: 0 },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  summary: { type: String, maxlength: 1000 },
  selectionReason: { type: String, maxlength: 1000 },
  score: { type: Number, min: 0, max: 100 },
  selectionMode: { type: String, enum: ['ai', 'fallback', 'mock'] },
  suggestedCaption: { type: String, maxlength: 1000 },
  topic: { type: String, maxlength: 120 },
  quality: {
    status: { type: String, enum: ['passed', 'failed', 'not_run'], default: 'not_run' },
    checks: [{ name: { type: String, maxlength: 120 }, passed: Boolean, detail: { type: String, maxlength: 500 } }],
    checkedAt: { type: Date }
  },
  state: { type: String, enum: ['proposed', 'rendering', 'ready', 'failed', 'deleted'], default: 'proposed', index: true },
  output: {
    width: { type: Number },
    height: { type: Number },
    durationSeconds: { type: Number },
    hasWatermark: { type: Boolean, default: false }
  },
  expiresAt: { type: Date, index: true },
  deletedAt: { type: Date }
}, { timestamps: true });

clipSchema.index({ ownerId: 1, projectId: 1, createdAt: -1 });
export type Clip = InferSchemaType<typeof clipSchema>;
export const ClipModel = model('Clip', clipSchema);
