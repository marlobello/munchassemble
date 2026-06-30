// app/src/web/server.ts
// Minimal HTTP server (Node built-in `http`) for the analytics web app (ADR-0006).
// Routes:
//   GET /health         → liveness probe (Container Apps)
//   GET /               → dashboard (authenticated guild members) or login page
//   GET /login          → begin Discord OAuth2
//   GET /auth/callback  → complete OAuth, verify guild membership, set session cookie
//   GET /logout         → clear session
//
// AuthZ (BR-070): only Discord users who are members of a configured guild may view
// any analytics page.

import { createServer, Server, IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { logger } from '../utils/logger.js';
import { getWebConfig, type WebConfig } from './webConfig.js';
import {
  SESSION_COOKIE,
  STATE_COOKIE,
  parseCookies,
  cookie,
  clearCookie,
  createSessionToken,
  readSessionToken,
  createState,
  verifyState,
  buildAuthorizeUrl,
  exchangeCode,
  fetchCurrentUser,
  fetchUserGuildIds,
  isGuildMember,
  type DiscordUser,
} from './auth.js';
import { buildAnalyticsSummaryForGuilds } from './analytics.js';
import { renderDashboard, renderLogin, renderDenied } from './views.js';

function send(res: ServerResponse, status: number, body: string, headers: Record<string, string | string[]> = {}): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(body);
}

function redirect(res: ServerResponse, location: string, headers: Record<string, string | string[]> = {}): void {
  res.writeHead(302, { Location: location, ...headers });
  res.end();
}

async function handle(req: IncomingMessage, res: ServerResponse, config: WebConfig): Promise<void> {
  const secure = config.nodeEnv === 'production';
  const url = new URL(req.url ?? '/', config.baseUrl);
  const cookies = parseCookies(req.headers.cookie);

  // Liveness probe — never authenticated.
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }

  // Begin OAuth.
  if (req.method === 'GET' && url.pathname === '/login') {
    const state = createState(config.sessionSecret);
    redirect(res, buildAuthorizeUrl(config, state), {
      'Set-Cookie': cookie(STATE_COOKIE, state, { secure, maxAgeMs: 10 * 60 * 1000 }),
    });
    return;
  }

  // OAuth callback.
  if (req.method === 'GET' && url.pathname === '/auth/callback') {
    const code = url.searchParams.get('code') ?? undefined;
    const state = url.searchParams.get('state') ?? undefined;
    if (!code || !verifyState(state, cookies[STATE_COOKIE], config.sessionSecret)) {
      send(res, 400, renderLogin('/login', 'Sign-in failed (invalid state). Please try again.'), {
        'Set-Cookie': clearCookie(STATE_COOKIE, secure),
      });
      return;
    }
    try {
      const accessToken = await exchangeCode(config, code);
      const [user, guildIds] = await Promise.all([
        fetchCurrentUser(accessToken),
        fetchUserGuildIds(accessToken),
      ]);
      if (!isGuildMember(guildIds, config.guildIds)) {
        logger.info(`[web] Access denied for user ${user.id} (not a guild member)`);
        send(res, 403, renderDenied(), { 'Set-Cookie': clearCookie(STATE_COOKIE, secure) });
        return;
      }
      const token = createSessionToken({ userId: user.id, username: user.username }, config.sessionSecret);
      redirect(res, '/', {
        'Set-Cookie': [
          clearCookie(STATE_COOKIE, secure),
          cookie(SESSION_COOKIE, token, { secure, maxAgeMs: 8 * 60 * 60 * 1000 }),
        ],
      });
    } catch (err) {
      logger.error('[web] OAuth callback error:', err);
      send(res, 502, renderLogin('/login', 'Sign-in failed. Please try again.'));
    }
    return;
  }

  // Logout.
  if (req.method === 'GET' && url.pathname === '/logout') {
    redirect(res, '/', { 'Set-Cookie': clearCookie(SESSION_COOKIE, secure) });
    return;
  }

  // Dashboard (authenticated).
  if (req.method === 'GET' && url.pathname === '/') {
    const session = readSessionToken(cookies[SESSION_COOKIE], config.sessionSecret);
    if (!session) {
      send(res, 200, renderLogin('/login'));
      return;
    }
    const user: DiscordUser = { id: session.userId, username: session.username };
    try {
      const summary = await buildAnalyticsSummaryForGuilds(config.guildIds);
      send(res, 200, renderDashboard(summary, user));
    } catch (err) {
      logger.error('[web] Failed to build analytics:', err);
      send(res, 500, renderLogin('/login', 'Could not load analytics right now.'));
    }
    return;
  }

  send(res, 404, renderLogin('/login', 'Page not found.'));
}

/** Create (but do not start) the analytics HTTP server. */
export function createWebServer(): Server {
  const config = getWebConfig();
  return createServer((req, res) => {
    handle(req, res, config).catch((err) => {
      logger.error('[web] Unhandled request error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    });
  });
}
