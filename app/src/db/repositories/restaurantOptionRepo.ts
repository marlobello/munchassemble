import { ItemDefinition } from '@azure/cosmos';
import { getDatabase, CONTAINERS } from '../cosmosClient.js';
import type { RestaurantOption } from '../../types/index.js';

const container = () => getDatabase().container(CONTAINERS.restaurantoptions);

export async function getRestaurantOptionsForGuild(guildId: string): Promise<RestaurantOption[]> {
  const { resources } = await container()
    .items.query<RestaurantOption>({
      query: 'SELECT * FROM c WHERE c.guildId = @guildId AND c.isActive = true ORDER BY c.name',
      parameters: [{ name: '@guildId', value: guildId }],
    })
    .fetchAll();
  return resources;
}

export async function upsertRestaurantOption(opt: RestaurantOption): Promise<RestaurantOption> {
  const { resource } = await container().items.upsert(opt as unknown as ItemDefinition);
  return resource as unknown as RestaurantOption;
}

export async function deleteRestaurantOption(guildId: string, name: string): Promise<void> {
  const id = `${guildId}::${name.toLowerCase()}`;
  await container().item(id, guildId).delete();
}
