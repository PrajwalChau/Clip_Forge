import mongoose from 'mongoose';
import type { Env } from './env.js';

export const connectDatabase = async (env: Env): Promise<void> => {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 8_000 });
};
