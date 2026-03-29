import { randomUUID } from 'crypto';
import type { Restaurant } from '../types/index.js';
import {
  createRestaurant,
  getRestaurantsForSession,
  getRestaurantById,
  castVote,
} from '../db/repositories/restaurantRepo.js';
import { recordUsage } from '../db/repositories/favoriteRepo.js';

export async function addRestaurant(
  sessionId: string,
  guildId: string,
  name: string,
  addedBy: string,
): Promise<Restaurant> {
  const now = new Date().toISOString();
  const restaurant: Restaurant = {
    id: `${sessionId}::${randomUUID()}`,
    sessionId,
    name: name.trim(),
    addedBy,
    votes: [],
    createdAt: now,
  };
  const created = await createRestaurant(restaurant);
  await recordUsage(guildId, name);
  return created;
}

export async function voteForRestaurant(
  sessionId: string,
  restaurantId: string,
  userId: string,
): Promise<Restaurant> {
  return castVote(sessionId, restaurantId, userId);
}

export { getRestaurantsForSession, getRestaurantById };
