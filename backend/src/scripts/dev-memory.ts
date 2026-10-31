import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1' } });
process.env.MONGODB_URI = mongo.getUri('clipforge');
process.env.JWT_SECRET ??= 'local-development-only-secret-that-must-not-be-used-in-production';
process.env.QUEUE_MODE ??= 'inline';
process.env.STORAGE_PROVIDER ??= 'local';
process.env.PAYMENTS_MODE ??= 'disabled';
process.env.FRONTEND_URL ??= 'http://127.0.0.1:5173';
process.env.COOKIE_SECURE ??= 'false';
process.env.VIDEO_PROCESSING_MODE ??= 'demo';
process.env.TRANSCRIPTION_PROVIDER ??= 'mock';
process.env.AI_PROVIDER ??= 'mock';

const { startServer } = await import('../server.js');
const { shutdown } = await startServer();
console.log('ClipForge development database is running in memory. Data will be cleared when this process stops.');

const stop = async (): Promise<void> => {
  await shutdown();
  await mongo.stop();
  process.exit(0);
};
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
