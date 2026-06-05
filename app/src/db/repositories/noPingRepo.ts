import { ItemDefinition } from '@azure/cosmos';
import { getDatabase, CONTAINERS } from '../cosmosClient.js';
import type { NoPingEntry } from '../../types/index.js';

const container = () => getDatabase().container(CONTAINERS.noping);

export async function getNoPingListForGuild(guildId: string): Promise<NoPingEntry[]> {
  const { resources } = await container()
    .items.query<NoPingEntry>({
      query: 'SELECT * FROM c WHERE c.guildId = @guildId',
      parameters: [{ name: '@guildId', value: guildId }],
    })
    .fetchAll();
  return resources;
}

export async function addNoPingEntry(guildId: string, userId: string): Promise<NoPingEntry> {
  const entry: NoPingEntry = {
    id: `${guildId}::${userId}`,
    guildId,
    userId,
    addedAt: new Date().toISOString(),
  };
  const { resource } = await container().items.upsert(entry as unknown as ItemDefinition);
  return resource as unknown as NoPingEntry;
}

export async function removeNoPingEntry(guildId: string, userId: string): Promise<void> {
  const id = `${guildId}::${userId}`;
  await container().item(id, guildId).delete();
}
