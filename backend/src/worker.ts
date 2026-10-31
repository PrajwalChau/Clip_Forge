import { connectDatabase } from './config/db.js';
import { getEnv } from './config/env.js';
import { createStorageService } from './services/storage.js';
import { ProcessingDispatcher } from './workers/processing.js';
import { PublishingDispatcher } from './workers/publishing.js';

const env = getEnv();
if (env.QUEUE_MODE !== 'bullmq') throw new Error('The standalone worker requires QUEUE_MODE=bullmq and a reachable Redis instance. Use the embedded worker only for isolated local development.');

await connectDatabase(env);
const storage = createStorageService(env);
const dispatcher = new ProcessingDispatcher(env, storage);
await dispatcher.start(true);
const publishingDispatcher = new PublishingDispatcher(env, storage);
await publishingDispatcher.start(true);
const initialCleanup = await dispatcher.cleanupStaleFiles();
console.log(`ClipForge worker is ready (concurrency ${env.WORKER_CONCURRENCY}; cleaned ${initialCleanup} stale work directories).`);
const cleanupTimer = setInterval(() => { void dispatcher.cleanupStaleFiles().catch(() => undefined); }, 60 * 60 * 1_000);

const shutdown = async (): Promise<void> => {
  clearInterval(cleanupTimer);
  await dispatcher.close();
  await publishingDispatcher.close();
  process.exit(0);
};
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
