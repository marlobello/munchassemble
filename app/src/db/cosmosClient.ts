import { CosmosClient, Database } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import { getConfig } from '../config.js';

let _db: Database | null = null;

/**
 * Returns the Cosmos DB Database singleton.
 * Uses DefaultAzureCredential in production (Managed Identity) and
 * falls back to key-based auth when COSMOS_KEY is set (local dev).
 */
export function getDatabase(): Database {
  if (_db) return _db;

  const { cosmosEndpoint, cosmosKey, cosmosDatabase } = getConfig();

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
  favorites: 'favorites',
} as const;
