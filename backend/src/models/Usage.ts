import { Schema, model, type InferSchemaType } from 'mongoose';

const usageSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  periodKey: { type: String, required: true },
  processingSeconds: { type: Number, default: 0, min: 0 },
  generatedClips: { type: Number, default: 0, min: 0 },
  reservedProcessingSeconds: { type: Number, default: 0, min: 0 },
  reservedGeneratedClips: { type: Number, default: 0, min: 0 },
  storageBytes: { type: Number, default: 0, min: 0 },
  reservedBytes: { type: Number, default: 0, min: 0 },
  resetAt: { type: Date, required: true }
}, { timestamps: true });

usageSchema.index({ ownerId: 1, periodKey: 1 }, { unique: true });
export type Usage = InferSchemaType<typeof usageSchema>;
export const UsageModel = model('Usage', usageSchema);
