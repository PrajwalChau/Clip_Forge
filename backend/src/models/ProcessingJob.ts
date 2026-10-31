import { Schema, model, type InferSchemaType } from 'mongoose';

const processingJobSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  sourceAssetId: { type: Schema.Types.ObjectId, ref: 'VideoAsset', required: true },
  queueJobId: { type: String, unique: true, sparse: true },
  status: { type: String, enum: ['queued', 'processing', 'completed', 'failed', 'cancelled'], default: 'queued', index: true },
  step: { type: String, enum: ['queued', 'validating', 'transcribing', 'analyzing', 'rendering', 'quality_check', 'uploading', 'finalizing'], default: 'queued' },
  progress: { type: Number, default: 0, min: 0, max: 100 },
  transcriptId: { type: Schema.Types.ObjectId, ref: 'Transcript' },
  selectionMode: { type: String, enum: ['ai', 'fallback', 'mock'] },
  processingConfig: {
    subtitles: { type: Boolean },
    requestedClipCount: { type: Number, min: 1, max: 10 },
    targetDurationSeconds: { type: Number, min: 15, max: 180 },
    aspectRatio: { type: String },
    editingStyle: { type: String, enum: ['clipforge', 'full_video_active_speaker'] }
  },
  attempts: { type: Number, default: 0, min: 0 },
  errorCode: { type: String, maxlength: 100 },
  errorMessage: { type: String, maxlength: 1000 },
  cancellationRequestedAt: { type: Date },
  cancelledAt: { type: Date },
  startedAt: { type: Date },
  completedAt: { type: Date }
}, { timestamps: true });

processingJobSchema.index({ projectId: 1, status: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['queued', 'processing'] } } });
export type ProcessingJob = InferSchemaType<typeof processingJobSchema>;
export const ProcessingJobModel = model('ProcessingJob', processingJobSchema);
