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

export async function isNoPingUser(guildId: string, userId: string): Promise<boolean> {
  const id = `${guildId}::${userId}`;
  try {
    const { resource } = await container().item(id, guildId).read<NoPingEntry>();
    return !!resource;
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code: number }).code === 404) {
      return false;
    }
    throw err;
  }
}
