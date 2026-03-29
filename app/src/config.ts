import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';

interface Config {
  discordBotToken: string;
  discordApplicationId: string;
  discordGuildId?: string;
  cosmosEndpoint: string;
  cosmosKey?: string;
  cosmosDatabase: string;
  nodeEnv: string;
  logLevel: string;
}

let _config: Config | null = null;

/** Load secrets from Key Vault if KEY_VAULT_NAME is set. */
async function loadFromKeyVault(vaultName: string): Promise<Partial<Record<string, string>>> {
  const url = `https://${vaultName}.vault.azure.net`;
  const client = new SecretClient(url, new DefaultAzureCredential());
  const secrets: Partial<Record<string, string>> = {};
  for await (const prop of client.listPropertiesOfSecrets()) {
    const secret = await client.getSecret(prop.name!);
    secrets[prop.name!] = secret.value;
  }
  return secrets;
}

/** Initialize config — call once at startup before accessing getConfig(). */
export async function initConfig(): Promise<void> {
  let kvSecrets: Partial<Record<string, string>> = {};
  const vaultName = process.env.KEY_VAULT_NAME;
  if (vaultName) {
    console.log(`[config] Loading secrets from Key Vault: ${vaultName}`);
    kvSecrets = await loadFromKeyVault(vaultName);
  }

  const get = (envKey: string, kvKey?: string): string | undefined =>
    kvSecrets[kvKey ?? envKey] ?? process.env[envKey];

  const botToken = get('DISCORD_BOT_TOKEN', 'discord-bot-token');
  const appId = get('DISCORD_APPLICATION_ID', 'discord-application-id');
  const cosmosEndpoint = get('COSMOS_ENDPOINT', 'cosmos-endpoint');

  if (!botToken) throw new Error('Missing required config: DISCORD_BOT_TOKEN');
  if (!appId) throw new Error('Missing required config: DISCORD_APPLICATION_ID');
  if (!cosmosEndpoint) throw new Error('Missing required config: COSMOS_ENDPOINT');

  _config = {
    discordBotToken: botToken,
    discordApplicationId: appId,
    discordGuildId: get('DISCORD_GUILD_ID'),
    cosmosEndpoint,
    cosmosKey: get('COSMOS_KEY', 'cosmos-key'),
    cosmosDatabase: get('COSMOS_DATABASE') ?? 'munchassemble',
    nodeEnv: process.env.NODE_ENV ?? 'production',
    logLevel: process.env.LOG_LEVEL ?? 'info',
  };
}

export function getConfig(): Config {
  if (!_config) throw new Error('Config not initialized — call initConfig() first');
  return _config;
}
