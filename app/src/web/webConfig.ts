// app/src/web/webConfig.ts
// Configuration for the read-only analytics web app (ADR-0006).
//
// Secrets (Discord OAuth client secret, session-cookie signing secret) are loaded from
// Key Vault via Managed Identity (NFR §1) — never committed. Non-secret settings come
// from environment variables injected by the Container App (see webContainerApp.bicep).

import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';
import { randomBytes } from 'node:crypto';
import { logger } from '../utils/logger.js';

export interface WebConfig {
  /** Discord guild IDs whose members may access the app (BR-070). */
  guildIds: string[];
  /** Discord OAuth2 application (client) ID — public. */
  oauthClientId: string;
  /** Discord OAuth2 client secret — from Key Vault. */
  oauthClientSecret: string;
  /** HMAC secret used to sign session cookies — from Key Vault (random in local dev). */
  sessionSecret: string;
  /** Public base URL of the app, used to build the OAuth redirect URI. */
  baseUrl: string;
  /** Port the HTTP server listens on. */
  port: number;
  nodeEnv: string;
}

let _config: WebConfig | null = null;

async function getKvSecret(client: SecretClient, name: string): Promise<string | undefined> {
  try {
    const secret = await client.getSecret(name);
    return secret.value;
  } catch {
    return undefined;
  }
}

/** Initialize web config — call once at startup before getWebConfig(). */
export async function initWebConfig(): Promise<void> {
  const vaultName = process.env.KEY_VAULT_NAME;

  let oauthClientSecret = process.env.DISCORD_OAUTH_CLIENT_SECRET;
  let sessionSecret = process.env.WEB_SESSION_SECRET;

  if (vaultName) {
    logger.info(`[web/config] Loading secrets from Key Vault: ${vaultName}`);
    const url = `https://${vaultName}.vault.azure.net`;
    const client = new SecretClient(url, new DefaultAzureCredential());
    // Only fetch the specific secrets we need — no list permission required (NFR §1).
    oauthClientSecret = (await getKvSecret(client, 'discord-oauth-client-secret')) ?? oauthClientSecret;
    sessionSecret = (await getKvSecret(client, 'web-session-secret')) ?? sessionSecret;
  }

  // In local dev with no Key Vault, fall back to a random per-process session secret so
  // cookies still work (sessions simply don't survive a restart).
  if (!sessionSecret) {
    sessionSecret = randomBytes(32).toString('hex');
    logger.warn('[web/config] No session secret configured — using an ephemeral random secret (dev only).');
  }

  const guildIds = (process.env.DISCORD_GUILD_ID ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  const oauthClientId = process.env.DISCORD_OAUTH_CLIENT_ID ?? '';
  const baseUrl = (process.env.WEB_BASE_URL ?? `http://localhost:${process.env.WEB_PORT ?? '8080'}`).replace(/\/$/, '');
  const port = Number(process.env.WEB_PORT ?? '8080');

  if (guildIds.length === 0) throw new Error('Missing required config: DISCORD_GUILD_ID');
  if (!process.env.COSMOS_ENDPOINT) throw new Error('Missing required config: COSMOS_ENDPOINT');
  if (!oauthClientId) throw new Error('Missing required config: DISCORD_OAUTH_CLIENT_ID');
  if (!oauthClientSecret) {
    throw new Error('Missing required config: discord-oauth-client-secret (Key Vault) or DISCORD_OAUTH_CLIENT_SECRET (env)');
  }

  _config = {
    guildIds,
    oauthClientId,
    oauthClientSecret,
    sessionSecret,
    baseUrl,
    port,
    nodeEnv: process.env.NODE_ENV ?? 'production',
  };
}

export function getWebConfig(): WebConfig {
  if (!_config) throw new Error('Web config not initialized — call initWebConfig() first');
  return _config;
}

/** Test-only helper to inject config without Key Vault / env. */
export function __setWebConfigForTest(config: WebConfig): void {
  _config = config;
}
