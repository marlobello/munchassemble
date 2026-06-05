import { createServer, Server } from 'http';
import { logger } from './logger.js';

/**
 * Starts a minimal HTTP health server on the given port.
 * GET /health → 200 OK (liveness probe for Container Apps — O2).
 * Returns the server so callers can close it during graceful shutdown.
 */
export function startHealthServer(port: number = 3000): Server {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, () => {
    logger.info(`[health] Listening on port ${port}`);
  });

  server.on('error', (err) => {
    logger.error('[health] Server error:', err);
  });

  return server;
}
