import { connectDatabase } from '../config/db.js';
import { getEnv } from '../config/env.js';
import { UserModel } from '../models/User.js';
import { hashPassword } from '../services/auth.js';

const env = getEnv();
if (env.NODE_ENV === 'production') throw new Error('Development users cannot be seeded in production.');
const password = process.env.CLIPFORGE_SEED_PASSWORD;
if (!password || password.length < 12) throw new Error('Set CLIPFORGE_SEED_PASSWORD to a unique development-only password of at least 12 characters.');

await connectDatabase(env);
const passwordHash = await hashPassword(password);
const users = [
  { name: 'Demo Creator One', email: 'creator.one@example.test' },
  { name: 'Demo Creator Two', email: 'creator.two@example.test' }
];
for (const user of users) {
  await UserModel.updateOne({ email: user.email }, { $set: { ...user, passwordHash, role: 'user', accountStatus: 'active', plan: 'free' } }, { upsert: true });
}
console.log(`Seeded ${users.length} ordinary development users.`);
process.exit(0);
