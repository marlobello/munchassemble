import { ItemDefinition } from '@azure/cosmos';
import { getDatabase, CONTAINERS } from '../cosmosClient.js';
import type { Favorite } from '../../types/index.js';

const container = () => getDatabase().container(CONTAINERS.favorites);

/** Returns top N favorites for a guild, sorted by usage count (BR-024). */
export async function getTopFavorites(guildId: string, limit = 10): Promise<Favorite[]> {
  const { resources } = await container()
    .items.query<Favorite>({
      query: `SELECT * FROM c WHERE c.guildId = @guildId`,
      parameters: [{ name: '@guildId', value: guildId }],
    })
    .fetchAll();
  return resources.sort((a, b) => b.usageCount - a.usageCount).slice(0, limit);
  return resources;
}

/** Record a restaurant name as used — increments count or creates a new favorite (BR-024). */
export async function recordUsage(guildId: string, name: string): Promise<void> {
  const normalized = name.trim().toLowerCase();
  const id = `${guildId}::${normalized}`;
  const now = new Date().toISOString();

  try {
    const { resource: existing } = await container().item(id, guildId).read<Favorite>();
    if (existing) {
      await container().item(id, guildId).replace({
        ...existing,
        usageCount: existing.usageCount + 1,
        lastUsedAt: now,
      } as unknown as ItemDefinition);
      return;
    }
  } catch {
    // not found — create below
  }

  const favorite: Favorite = {
    id,
    guildId,
    name: name.trim(),
    usageCount: 1,
    lastUsedAt: now,
  };
  await container().items.create(favorite as unknown as ItemDefinition);
}
