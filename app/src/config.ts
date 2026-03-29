import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';

interface Config {
  discordBotToken: string;
  discordApplicationId?: string;
  discordGuildId?: string;
  cosmosEndpoint: string;
  cosmosKey?: string;
  cosmosDatabase: string;
  nodeEnv: string;
  logLevel: string;
}

let _config: Config | null = null;

/** Fetch a single named secret from Key Vault (least-privilege — no list permission needed). */
async function getKvSecret(client: SecretClient, name: string): Promise<string | undefined> {
  try {
    const secret = await client.getSecret(name);
    return secret.value;
  } catch {
    return undefined;
  }
}

/** Initialize config — call once at startup before accessing getConfig(). */
export async function initConfig(): Promise<void> {
  const vaultName = process.env.KEY_VAULT_NAME;

  let botToken: string | undefined = process.env.DISCORD_BOT_TOKEN;

  if (vaultName) {
    console.log(`[config] Loading secrets from Key Vault: ${vaultName}`);
    const url = `https://${vaultName}.vault.azure.net`;
    const client = new SecretClient(url, new DefaultAzureCredential());

    // Only fetch the specific secrets we need — no list permission required
    botToken = (await getKvSecret(client, 'discord-bot-token')) ?? botToken;
  }

  const cosmosEndpoint = process.env.COSMOS_ENDPOINT;

  if (!botToken) throw new Error('Missing required config: discord-bot-token (Key Vault) or DISCORD_BOT_TOKEN (env)');
  if (!cosmosEndpoint) throw new Error('Missing required config: COSMOS_ENDPOINT');

  _config = {
    discordBotToken: botToken,
    // Application ID is not secret — injected as a plain env var. Optional because
    // the bot obtains its own ID from client.user.id after login.
    discordApplicationId: process.env.DISCORD_APPLICATION_ID,
    discordGuildId: process.env.DISCORD_GUILD_ID,
    cosmosEndpoint,
    cosmosKey: process.env.COSMOS_KEY, // only needed for local dev without Managed Identity
    cosmosDatabase: process.env.COSMOS_DATABASE ?? 'munchassemble',
    nodeEnv: process.env.NODE_ENV ?? 'production',
    logLevel: process.env.LOG_LEVEL ?? 'info',
  };
}

export function getConfig(): Config {
  if (!_config) throw new Error('Config not initialized — call initConfig() first');
  return _config;
}
