import { connectDatabase } from '../config/db.js';
import { getEnv } from '../config/env.js';
import { UserModel } from '../models/User.js';

const email = process.env.CLIPFORGE_BOOTSTRAP_EMAIL?.trim().toLowerCase();
if (!email || process.env.CLIPFORGE_BOOTSTRAP_CONFIRM !== email) {
  console.error('Refusing to change privileges. Set CLIPFORGE_BOOTSTRAP_EMAIL and repeat that value in CLIPFORGE_BOOTSTRAP_CONFIRM.');
  process.exit(1);
}

const env = getEnv();
await connectDatabase(env);
const activeAdmin = await UserModel.exists({ role: 'admin', accountStatus: 'active' });
if (activeAdmin) {
  console.error('Refusing bootstrap: an active administrator already exists. Use a controlled operational process for additional admins.');
  process.exit(1);
}

const user = await UserModel.findOne({ email });
if (!user) {
  console.error('Refusing bootstrap: create the user account first, then run the command again.');
  process.exit(1);
}

await UserModel.updateOne(
  { _id: user._id },
  { $set: { role: 'admin', plan: 'premium', accountStatus: 'active' }, $inc: { sessionVersion: 1 } }
);
console.log(`Administrator access granted to ${user.email}.`);
process.exit(0);
