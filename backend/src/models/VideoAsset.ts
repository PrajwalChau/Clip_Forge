import { Schema, model, type InferSchemaType } from 'mongoose';

const videoAssetSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  kind: { type: String, enum: ['source', 'rendered'], required: true, index: true },
  originalFilename: { type: String, required: true, maxlength: 255 },
  mimeType: { type: String, required: true, maxlength: 100 },
  sizeBytes: { type: Number, required: true, min: 0 },
  durationSeconds: { type: Number, min: 0 },
  width: { type: Number, min: 1 },
  height: { type: Number, min: 1 },
  storageProvider: { type: String, enum: ['local', 'r2'], required: true },
  objectKey: { type: String, required: true, unique: true, maxlength: 1024 },
  checksum: { type: String, maxlength: 128 },
  source: {
    type: { type: String, enum: ['user_upload', 'youtube_import'], default: 'user_upload' },
    rightsConfirmed: { type: Boolean, default: false },
    rightsConfirmedAt: { type: Date },
    provenance: { type: String, enum: ['user_declared', 'youtube_oembed'], default: 'user_declared' },
    sourceUrl: { type: String, maxlength: 2048 },
    creator: { type: String, maxlength: 255 },
    licenseType: { type: String, enum: ['unknown', 'owned', 'licensed', 'cc0', 'cc_by', 'cc_by_nc', 'cc_by_nd', 'other'], default: 'unknown' },
    licenseUrl: { type: String, maxlength: 2048 },
    attributionText: { type: String, maxlength: 2000 },
    commercialUseRestricted: { type: Boolean, default: false },
    derivativeWorksRestricted: { type: Boolean, default: false }
  },
  state: { type: String, enum: ['reserved', 'uploaded', 'processing', 'ready', 'failed', 'deleted'], default: 'reserved', index: true },
  reservedUntil: { type: Date },
  expiresAt: { type: Date, index: true },
  deletedAt: { type: Date }
}, { timestamps: true });

videoAssetSchema.index({ ownerId: 1, state: 1, deletedAt: 1 });
export type VideoAsset = InferSchemaType<typeof videoAssetSchema>;
export const VideoAssetModel = model('VideoAsset', videoAssetSchema);
