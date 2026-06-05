import { ItemDefinition } from '@azure/cosmos';
import { getDatabase, CONTAINERS } from '../cosmosClient.js';
import type { Restaurant } from '../../types/index.js';

const container = () => getDatabase().container(CONTAINERS.restaurants);

export async function createRestaurant(restaurant: Restaurant): Promise<Restaurant> {
  const { resource } = await container().items.create(restaurant as unknown as ItemDefinition);
  return resource as unknown as Restaurant;
}

export async function getRestaurantsForSession(sessionId: string): Promise<Restaurant[]> {
  const { resources } = await container()
    .items.query<Restaurant>({
      query: 'SELECT * FROM c WHERE c.sessionId = @sessionId',
      parameters: [{ name: '@sessionId', value: sessionId }],
    })
    .fetchAll();
  return resources.sort((a, b) => b.votes.length - a.votes.length);
}

export async function getRestaurantById(id: string, sessionId: string): Promise<Restaurant | null> {
  try {
    const { resource } = await container().item(id, sessionId).read<Restaurant>();
    return resource ?? null;
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code: number }).code === 404) {
      return null;
    }
    throw err;
  }
}

const MAX_VOTE_RETRIES = 5;

/**
 * Apply a vote mutation to a single restaurant with optimistic concurrency.
 * Re-reads and retries on a 412 (ETag mismatch) so concurrent voters don't
 * clobber each other's entries. Returns the updated restaurant, or null if it
 * no longer exists.
 */
async function mutateVotes(
  sessionId: string,
  restaurantId: string,
  mutate: (votes: string[]) => string[] | null,
): Promise<Restaurant | null> {
  for (let attempt = 0; attempt < MAX_VOTE_RETRIES; attempt++) {
    const restaurant = await getRestaurantById(restaurantId, sessionId);
    if (!restaurant) return null;

    const nextVotes = mutate(restaurant.votes);
    if (nextVotes === null) return restaurant; // no-op (e.g. already in desired state)

    const updated: Restaurant = { ...restaurant, votes: nextVotes };
    const options = restaurant._etag
      ? { accessCondition: { type: 'IfMatch' as const, condition: restaurant._etag } }
      : undefined;
    try {
      const { resource } = await container()
        .item(restaurantId, sessionId)
        .replace(updated as unknown as ItemDefinition, options);
      return resource as unknown as Restaurant;
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 412 && attempt < MAX_VOTE_RETRIES - 1) continue; // ETag mismatch — retry
      throw err;
    }
  }
  throw new Error(`Failed to update votes for ${restaurantId} after ${MAX_VOTE_RETRIES} attempts`);
}

/** Remove userId's vote from whichever restaurant they previously voted for (BR-021 — change vote). */
export async function removeVoteFromAll(sessionId: string, userId: string): Promise<void> {
  const restaurants = await getRestaurantsForSession(sessionId);
  const voted = restaurants.filter((r) => r.votes.includes(userId));
  await Promise.all(
    voted.map((r) =>
      mutateVotes(sessionId, r.id, (votes) =>
        votes.includes(userId) ? votes.filter((v) => v !== userId) : null,
      ),
    ),
  );
}

/** Cast or change vote: removes previous vote then adds to target (BR-021). */
export async function castVote(
  sessionId: string,
  restaurantId: string,
  userId: string,
): Promise<Restaurant> {
  await removeVoteFromAll(sessionId, userId);
  const result = await mutateVotes(sessionId, restaurantId, (votes) =>
    votes.includes(userId) ? null : [...votes, userId],
  );
  if (!result) throw new Error(`Restaurant ${restaurantId} not found`);
  return result;
}
