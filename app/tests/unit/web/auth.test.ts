import {
  sign,
  unsign,
  createSessionToken,
  readSessionToken,
  createState,
  verifyState,
  parseCookies,
  cookie,
  clearCookie,
  isGuildMember,
  buildAuthorizeUrl,
  redirectUri,
} from '../../../src/web/auth';
import type { WebConfig } from '../../../src/web/webConfig';

const SECRET = 'test-secret-value';

const config: WebConfig = {
  guildIds: ['g1', 'g2'],
  oauthClientId: 'client-123',
  oauthClientSecret: 'shh',
  sessionSecret: SECRET,
  baseUrl: 'https://example.test',
  port: 8080,
  nodeEnv: 'production',
};

describe('sign / unsign', () => {
  it('round-trips a value', () => {
    const token = sign('hello world', SECRET);
    expect(unsign(token, SECRET)).toBe('hello world');
  });

  it('rejects a tampered payload', () => {
    const token = sign('hello', SECRET);
    const tampered = `x${token}`;
    expect(unsign(tampered, SECRET)).toBeNull();
  });

  it('rejects a wrong secret', () => {
    const token = sign('hello', SECRET);
    expect(unsign(token, 'other-secret')).toBeNull();
  });

  it('returns null for a malformed token', () => {
    expect(unsign('no-dot-here', SECRET)).toBeNull();
  });
});

describe('session token', () => {
  it('round-trips session data', () => {
    const token = createSessionToken({ userId: 'u1', username: 'alice' }, SECRET);
    const data = readSessionToken(token, SECRET);
    expect(data).toMatchObject({ userId: 'u1', username: 'alice' });
  });

  it('rejects an expired token', () => {
    const token = createSessionToken({ userId: 'u1', username: 'alice' }, SECRET, -1000);
    expect(readSessionToken(token, SECRET)).toBeNull();
  });

  it('returns null for undefined token', () => {
    expect(readSessionToken(undefined, SECRET)).toBeNull();
  });
});

describe('oauth state', () => {
  it('verifies a matching, signed state', () => {
    const state = createState(SECRET);
    expect(verifyState(state, state, SECRET)).toBe(true);
  });

  it('rejects mismatched state (CSRF)', () => {
    const a = createState(SECRET);
    const b = createState(SECRET);
    expect(verifyState(a, b, SECRET)).toBe(false);
  });

  it('rejects missing state', () => {
    expect(verifyState(undefined, undefined, SECRET)).toBe(false);
  });
});

describe('parseCookies', () => {
  it('parses multiple cookies', () => {
    const out = parseCookies('a=1; b=hello%20world; c=');
    expect(out.a).toBe('1');
    expect(out.b).toBe('hello world');
    expect(out.c).toBe('');
  });

  it('returns empty object for undefined header', () => {
    expect(parseCookies(undefined)).toEqual({});
  });
});

describe('cookie serialization', () => {
  it('sets Secure + HttpOnly in production', () => {
    const c = cookie('ma_session', 'v', { secure: true, maxAgeMs: 1000 });
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
    expect(c).toContain('Max-Age=1');
  });

  it('omits Secure when not secure', () => {
    expect(cookie('x', 'v', { secure: false })).not.toContain('Secure');
  });

  it('clearCookie expires immediately', () => {
    expect(clearCookie('x', true)).toContain('Max-Age=0');
  });
});

describe('isGuildMember', () => {
  it('is true when the user shares any configured guild', () => {
    expect(isGuildMember(['z', 'g2'], ['g1', 'g2'])).toBe(true);
  });

  it('is false when there is no overlap', () => {
    expect(isGuildMember(['x', 'y'], ['g1', 'g2'])).toBe(false);
  });

  it('is false for an empty guild list', () => {
    expect(isGuildMember([], ['g1'])).toBe(false);
  });
});

describe('buildAuthorizeUrl', () => {
  it('includes client id, redirect uri, scopes and state', () => {
    const url = new URL(buildAuthorizeUrl(config, 'state-abc'));
    expect(url.origin + url.pathname).toBe('https://discord.com/api/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('redirect_uri')).toBe('https://example.test/auth/callback');
    expect(url.searchParams.get('scope')).toBe('identify guilds');
    expect(url.searchParams.get('state')).toBe('state-abc');
  });

  it('derives the redirect uri from the base url', () => {
    expect(redirectUri(config)).toBe('https://example.test/auth/callback');
  });
});
