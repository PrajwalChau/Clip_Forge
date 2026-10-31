import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { connectDatabase } from './config/db.js';
import { getEnv } from './config/env.js';
import { createStorageService } from './services/storage.js';
import { ProcessingDispatcher } from './workers/processing.js';
import { PublishingDispatcher } from './workers/publishing.js';

export const startServer = async (): Promise<{ shutdown: () => Promise<void> }> => {
  const env = getEnv();
  await connectDatabase(env);
  const storage = createStorageService(env);
  const dispatcher = new ProcessingDispatcher(env, storage);
  await dispatcher.start();
  const publishingDispatcher = new PublishingDispatcher(env, storage);
  await publishingDispatcher.start();
  const app = createApp(env, storage, dispatcher, publishingDispatcher);
  const server = app.listen(env.PORT, () => console.log(`ClipForge API listening on :${env.PORT}`));

  return {
    shutdown: async (): Promise<void> => {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await dispatcher.close();
      await publishingDispatcher.close();
    }
  };
};

const isDirectExecution = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  const { shutdown } = await startServer();
  const stop = async (): Promise<void> => { await shutdown(); process.exit(0); };
  process.on('SIGINT', () => { void stop(); });
  process.on('SIGTERM', () => { void stop(); });
}
