// app/src/web/auth.ts
// Discord OAuth2 (Authorization Code flow) + guild-membership gating + signed session
// cookies for the analytics web app (ADR-0006, BR-070). Uses only Node built-ins
// (crypto, global fetch) — no extra dependencies (NFR §6).

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import type { WebConfig } from './webConfig.js';

const DISCORD_API = 'https://discord.com/api';
const OAUTH_SCOPES = 'identify guilds';

/** Data we persist in the signed session cookie. */
export interface SessionData {
  userId: string;
  username: string;
  /** Expiry, epoch ms. */
  exp: number;
}

export const SESSION_COOKIE = 'ma_session';
export const STATE_COOKIE = 'ma_oauth_state';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

// ─── Generic HMAC sign/verify (base64url payload + signature) ──────────────────

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Sign an arbitrary string, returning `payload.signature` (both base64url). */
export function sign(value: string, secret: string): string {
  const payload = b64url(Buffer.from(value, 'utf8'));
  const sig = b64url(createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

/** Verify a `payload.signature` token; returns the original string or null. */
export function unsign(token: string, secret: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(createHmac('sha256', secret).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return b64urlDecode(payload).toString('utf8');
}

// ─── Session cookie ────────────────────────────────────────────────────────────

export function createSessionToken(
  data: Omit<SessionData, 'exp'>,
  secret: string,
  ttlMs: number = SESSION_TTL_MS,
): string {
  const session: SessionData = { ...data, exp: Date.now() + ttlMs };
  return sign(JSON.stringify(session), secret);
}

export function readSessionToken(token: string | undefined, secret: string): SessionData | null {
  if (!token) return null;
  const raw = unsign(token, secret);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as SessionData;
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

// ─── CSRF state ────────────────────────────────────────────────────────────────

/** Create a random, signed OAuth `state` value (CSRF protection). */
export function createState(secret: string): string {
  return sign(randomBytes(16).toString('hex'), secret);
}

/** Constant-time comparison of the returned state against the signed cookie value. */
export function verifyState(returned: string | undefined, cookieValue: string | undefined, secret: string): boolean {
  if (!returned || !cookieValue) return false;
  if (returned !== cookieValue) return false;
  return unsign(returned, secret) !== null;
}

// ─── Cookie header parsing ───────────────────────────────────────────────────

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function cookie(name: string, value: string, opts: { maxAgeMs?: number; secure: boolean }): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.secure) parts.push('Secure');
  if (opts.maxAgeMs !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAgeMs / 1000)}`);
  return parts.join('; ');
}

export function clearCookie(name: string, secure: boolean): string {
  const parts = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// ─── Guild membership ──────────────────────────────────────────────────────────

/** True if the user belongs to at least one configured guild (BR-070). */
export function isGuildMember(userGuildIds: string[], allowedGuildIds: string[]): boolean {
  const allowed = new Set(allowedGuildIds);
  return userGuildIds.some((id) => allowed.has(id));
}

// ─── Discord OAuth2 network calls ──────────────────────────────────────────────

export function redirectUri(config: WebConfig): string {
  return `${config.baseUrl}/auth/callback`;
}

export function buildAuthorizeUrl(config: WebConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.oauthClientId,
    redirect_uri: redirectUri(config),
    response_type: 'code',
    scope: OAUTH_SCOPES,
    state,
  });
  return `${DISCORD_API}/oauth2/authorize?${params.toString()}`;
}

export interface DiscordUser {
  id: string;
  username: string;
}

/** Exchange an authorization code for an access token. */
export async function exchangeCode(config: WebConfig, code: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: config.oauthClientId,
    client_secret: config.oauthClientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(config),
  });
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Discord token exchange failed: ${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('Discord token exchange returned no access_token');
  return json.access_token;
}

export async function fetchCurrentUser(accessToken: string): Promise<DiscordUser> {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Discord /users/@me failed: ${res.status}`);
  return (await res.json()) as DiscordUser;
}

export async function fetchUserGuildIds(accessToken: string): Promise<string[]> {
  const res = await fetch(`${DISCORD_API}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Discord /users/@me/guilds failed: ${res.status}`);
  const guilds = (await res.json()) as { id: string }[];
  return guilds.map((g) => g.id);
}
