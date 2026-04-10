import type { RestaurantOption } from '../types/index.js';
import {
  getRestaurantOptionsForGuild,
  upsertRestaurantOption,
  deleteRestaurantOption,
} from '../db/repositories/restaurantOptionRepo.js';

/** Return active restaurant options for the guild. */
export async function getRestaurantOptions(guildId: string): Promise<RestaurantOption[]> {
  return getRestaurantOptionsForGuild(guildId);
}

/** Add a new restaurant option. Returns the created entry. */
export async function addRestaurantOption(guildId: string, name: string): Promise<RestaurantOption> {
  const trimmed = name.trim();
  const opt: RestaurantOption = {
    id: `${guildId}::${trimmed.toLowerCase()}`,
    guildId,
    name: trimmed,
    isActive: true,
    createdAt: new Date().toISOString(),
  };
  return upsertRestaurantOption(opt);
}

/** Remove a restaurant option by name. */
export async function removeRestaurantOption(guildId: string, name: string): Promise<void> {
  return deleteRestaurantOption(guildId, name);
}
