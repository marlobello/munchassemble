import { randomUUID } from 'crypto';
import type { Restaurant } from '../types/index.js';
import {
  createRestaurant,
  getRestaurantsForSession,
  getRestaurantById,
  castVote,
  removeVoteFromAll,
} from '../db/repositories/restaurantRepo.js';
import { DuplicateError } from '../utils/errors.js';

/**
 * The winning restaurant for a session = the one with the most votes (BR-022/BR-023).
 * Returns null when there are no votes at all. Ties are broken deterministically
 * (earliest created, then id) so auto-lock at finalize is stable.
 */
export function pickWinningRestaurant(restaurants: Restaurant[]): Restaurant | null {
  const maxVotes = restaurants.reduce((m, r) => Math.max(m, r.votes.length), 0);
  if (maxVotes === 0) return null;
  return [...restaurants]
    .filter((r) => r.votes.length === maxVotes)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
}

export async function addRestaurant(
  sessionId: string,
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
    id: randomUUID(),
    sessionId,
    name: trimmed,
    addedBy,
    votes: [],
    createdAt: now,
  };
  return createRestaurant(restaurant);
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
