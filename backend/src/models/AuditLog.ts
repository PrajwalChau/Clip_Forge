import { Schema, model, type InferSchemaType } from 'mongoose';

const auditLogSchema = new Schema({
  actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  action: { type: String, required: true, trim: true, maxlength: 120, index: true },
  targetType: { type: String, required: true, trim: true, maxlength: 80 },
  targetId: { type: String, required: true, trim: true, maxlength: 128, index: true },
  reason: { type: String, trim: true, maxlength: 500 },
  outcome: { type: String, enum: ['success', 'failure'], required: true },
  metadata: { type: Schema.Types.Mixed, default: {} }
}, { timestamps: { createdAt: true, updatedAt: false } });

auditLogSchema.index({ createdAt: -1 });
export type AuditLog = InferSchemaType<typeof auditLogSchema>;
export const AuditLogModel = model('AuditLog', auditLogSchema);
