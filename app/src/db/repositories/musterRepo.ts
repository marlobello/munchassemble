import { ItemDefinition } from '@azure/cosmos';
import { getDatabase, CONTAINERS } from '../cosmosClient.js';
import type { MusterPointConfig } from '../../types/index.js';

const container = () => getDatabase().container(CONTAINERS.musterpoints);

const DEFAULT_MUSTER_POINTS = ['Garage A', 'Garage B', 'Main Lobby'];

export async function getMusterPointsForGuild(guildId: string): Promise<MusterPointConfig[]> {
  const { resources } = await container()
    .items.query<MusterPointConfig>({
      query: 'SELECT * FROM c WHERE c.guildId = @guildId AND c.isActive = true',
      parameters: [{ name: '@guildId', value: guildId }],
    })
    .fetchAll();
  return resources;
}

export async function upsertMusterPoint(mp: MusterPointConfig): Promise<MusterPointConfig> {
  const { resource } = await container().items.upsert(mp as unknown as ItemDefinition);
  return resource as unknown as MusterPointConfig;
}

export async function deleteMusterPoint(guildId: string, name: string): Promise<void> {
  const id = `${guildId}::${name.toLowerCase()}`;
  await container().item(id, guildId).delete();
}

/** Seed default muster points for a guild if they haven't been configured yet (BR-042). */
export async function seedDefaultMusterPoints(guildId: string): Promise<void> {
  const existing = await getMusterPointsForGuild(guildId);
  if (existing.length > 0) return;

  const now = new Date().toISOString();
  await Promise.all(
    DEFAULT_MUSTER_POINTS.map((name) =>
      upsertMusterPoint({
        id: `${guildId}::${name.toLowerCase()}`,
        guildId,
        name,
        isActive: true,
        createdAt: now,
      }),
    ),
  );
}
