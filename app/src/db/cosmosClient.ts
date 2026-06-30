import { CosmosClient, Database } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

let _db: Database | null = null;

/**
 * Returns the Cosmos DB Database singleton.
 *
 * Reads connection settings straight from the environment (COSMOS_ENDPOINT,
 * COSMOS_DATABASE, optional COSMOS_KEY) so the data layer can be shared by both the
 * bot and the read-only analytics web app (ADR-0006) without depending on the bot's
 * full config (which requires the Discord bot token).
 *
 * Uses DefaultAzureCredential in production (Managed Identity) and falls back to
 * key-based auth when COSMOS_KEY is set (local dev).
 */
export function getDatabase(): Database {
  if (_db) return _db;

  const cosmosEndpoint = process.env.COSMOS_ENDPOINT;
  if (!cosmosEndpoint) throw new Error('Missing required config: COSMOS_ENDPOINT');
  const cosmosKey = process.env.COSMOS_KEY; // only for local dev without Managed Identity
  const cosmosDatabase = process.env.COSMOS_DATABASE ?? 'munchassemble';

  const client = cosmosKey
    ? new CosmosClient({ endpoint: cosmosEndpoint, key: cosmosKey })
    : new CosmosClient({ endpoint: cosmosEndpoint, aadCredentials: new DefaultAzureCredential() });

  _db = client.database(cosmosDatabase);
  return _db;
}

export const CONTAINERS = {
  sessions: 'sessions',
  participants: 'participants',
  restaurants: 'restaurants',
  carpools: 'carpools',
  musterpoints: 'musterpoints',
  restaurantoptions: 'restaurantoptions',
  noping: 'noping',
} as const;
