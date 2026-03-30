import { createServer } from 'http';

/**
 * Starts a minimal HTTP health server on the given port.
 * GET /health → 200 OK (liveness probe for Container Apps — O2).
 */
export function startHealthServer(port: number = 3000): void {
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
    console.log(`[health] Listening on port ${port}`);
  });

  server.on('error', (err) => {
    console.error('[health] Server error:', err);
  });
}
