import { randomUUID } from 'crypto';
import type { Restaurant } from '../types/index.js';
import {
  createRestaurant,
  getRestaurantsForSession,
  getRestaurantById,
  castVote,
  removeVoteFromAll,
} from '../db/repositories/restaurantRepo.js';
import { recordUsage } from '../db/repositories/favoriteRepo.js';
import { DuplicateError } from '../utils/errors.js';

export async function addRestaurant(
  sessionId: string,
  guildId: string,
  name: string,
  addedBy: string,
): Promise<Restaurant> {
  const trimmed = name.trim();

  // Prevent duplicate names (case-insensitive) within the same session
  const existing = await getRestaurantsForSession(sessionId);
  const duplicate = existing.find(
    (r) => r.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (duplicate) throw new DuplicateError(`${trimmed} is already on the list.`);

  const now = new Date().toISOString();
  const restaurant: Restaurant = {
    id: `${sessionId}::${randomUUID()}`,
    sessionId,
    name: trimmed,
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

/**
 * Removes the user's vote from any restaurant in this session.
 * Called when attendance changes to Out (BR cascade rule).
 */
export async function removeVote(sessionId: string, userId: string): Promise<void> {
  return removeVoteFromAll(sessionId, userId);
}
