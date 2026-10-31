import { Schema, model, type InferSchemaType } from 'mongoose';

const userSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
  avatarUrl: { type: String, trim: true, maxlength: 2048 },
  role: { type: String, enum: ['user', 'admin'], default: 'user', index: true },
  accountStatus: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },
  suspendedAt: { type: Date },
  suspensionReason: { type: String, maxlength: 500 },
  sessionVersion: { type: Number, default: 0, min: 0, select: false },
  plan: { type: String, enum: ['free', 'pro', 'premium'], default: 'free', index: true },
  lastLoginAt: { type: Date }
}, { timestamps: true });

export type User = InferSchemaType<typeof userSchema>;
export const UserModel = model('User', userSchema);
