import { Schema, model, type InferSchemaType } from 'mongoose';

const projectSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true, minlength: 1, maxlength: 160 },
  status: { type: String, enum: ['draft', 'uploaded', 'queued', 'processing', 'completed', 'failed', 'cancelled'], default: 'draft', index: true },
  sourceAssetId: { type: Schema.Types.ObjectId, ref: 'VideoAsset' },
  settings: {
    targetDurationSeconds: { type: Number, default: 15, min: 15, max: 180 },
    requestedClipCount: { type: Number, default: 3, min: 1, max: 10 },
    aspectRatio: { type: String, enum: ['9:16'], default: '9:16' },
    editingStyle: { type: String, enum: ['clipforge', 'full_video_active_speaker'], default: 'clipforge' },
    subtitles: { type: Boolean, default: true },
    watermark: { type: Boolean, default: true }
  },
  failureCode: { type: String, maxlength: 100 },
  failureMessage: { type: String, maxlength: 1000 },
  sourceType: { type: String, enum: ['upload', 'youtube'], default: 'upload' },
  youtubeUrl: { type: String, maxlength: 2048 },
  youtubeVideoId: { type: String, maxlength: 32 },
  youtubeMetadata: {
    title: { type: String, maxlength: 255 },
    authorName: { type: String, maxlength: 255 },
    thumbnailUrl: { type: String, maxlength: 2048 },
    durationSeconds: { type: Number, min: 0 }
  }
}, { timestamps: true });

projectSchema.index({ ownerId: 1, updatedAt: -1 });
export type Project = InferSchemaType<typeof projectSchema>;
export const ProjectModel = model('Project', projectSchema);
