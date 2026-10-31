import { Schema, model, type InferSchemaType } from 'mongoose';

const transcriptSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  processingJobId: { type: Schema.Types.ObjectId, ref: 'ProcessingJob', required: true, unique: true },
  provider: { type: String, enum: ['openai', 'whisper_local', 'mock'], required: true },
  isDemo: { type: Boolean, default: false },
  language: { type: String, maxlength: 32 },
  text: { type: String, required: true, maxlength: 500_000 },
  segments: [{ startSeconds: { type: Number, min: 0, required: true }, endSeconds: { type: Number, min: 0, required: true }, text: { type: String, maxlength: 5_000, required: true } }]
}, { timestamps: true });

transcriptSchema.index({ ownerId: 1, projectId: 1, createdAt: -1 });
export type Transcript = InferSchemaType<typeof transcriptSchema>;
export const TranscriptModel = model('Transcript', transcriptSchema);
