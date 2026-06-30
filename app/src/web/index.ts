// app/src/web/index.ts
// Entrypoint for the read-only analytics web app (ADR-0006). Started via `npm run
// start:web` / Dockerfile.web. Separate process from the Discord bot.

import { initWebConfig, getWebConfig } from './webConfig.js';
import { createWebServer } from './server.js';
import { logger } from '../utils/logger.js';

async function main(): Promise<void> {
  await initWebConfig();
  const config = getWebConfig();
  const server = createWebServer();

  server.listen(config.port, () => {
    logger.info(`[web] Analytics web app listening on port ${config.port}`);
  });

  // Graceful shutdown on revision swaps (NFR §2).
  const shutdown = (signal: string): void => {
    logger.info(`[web] ${signal} received — shutting down`);
    server.close(() => process.exit(0));
    // Force-exit if connections don't drain promptly.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('[web] Fatal startup error:', err);
  process.exit(1);
});
