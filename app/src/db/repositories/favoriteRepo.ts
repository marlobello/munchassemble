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
  } catch (err: unknown) {
    const code = (err as { code?: number }).code;
    if (code !== 404) throw err; // unexpected error — rethrow
    // 404: item not found — fall through to create
  }

  const favorite: Favorite = {
    id,
    guildId,
    name: name.trim(),
    usageCount: 1,
    lastUsedAt: now,
  };
  try {
    await container().items.create(favorite as unknown as ItemDefinition);
  } catch (err: unknown) {
    // 409: race condition — another request created it first; safe to ignore
    if ((err as { code?: number }).code !== 409) throw err;
  }
}
