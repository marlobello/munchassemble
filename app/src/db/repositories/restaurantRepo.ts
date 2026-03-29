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
      query: 'SELECT * FROM c WHERE c.sessionId = @sessionId ORDER BY ARRAY_LENGTH(c.votes) DESC',
      parameters: [{ name: '@sessionId', value: sessionId }],
    })
    .fetchAll();
  return resources;
}

export async function getRestaurantById(id: string, sessionId: string): Promise<Restaurant | null> {
  try {
    const { resource } = await container().item(id, sessionId).read<Restaurant>();
    return resource ?? null;
  } catch {
    return null;
  }
}

/** Toggle a vote: adds userId if not present, removes if already voted (BR-021). */
export async function setVote(
  restaurantId: string,
  sessionId: string,
  userId: string,
): Promise<Restaurant> {
  const restaurant = await getRestaurantById(restaurantId, sessionId);
  if (!restaurant) throw new Error(`Restaurant ${restaurantId} not found`);

  const hadVote = restaurant.votes.includes(userId);
  const updated: Restaurant = {
    ...restaurant,
    votes: hadVote
      ? restaurant.votes.filter((v) => v !== userId)
      : [...restaurant.votes, userId],
  };
  const { resource } = await container()
    .item(restaurantId, sessionId)
    .replace(updated as unknown as ItemDefinition);
  return resource as unknown as Restaurant;
}

/** Remove userId's vote from whichever restaurant they previously voted for (BR-021 — change vote). */
export async function removeVoteFromAll(sessionId: string, userId: string): Promise<void> {
  const restaurants = await getRestaurantsForSession(sessionId);
  const voted = restaurants.filter((r) => r.votes.includes(userId));
  await Promise.all(
    voted.map(async (r) => {
      const updated = { ...r, votes: r.votes.filter((v) => v !== userId) };
      await container().item(r.id, sessionId).replace(updated as unknown as ItemDefinition);
    }),
  );
}

/** Cast or change vote: removes previous vote then adds to target (BR-021). */
export async function castVote(
  sessionId: string,
  restaurantId: string,
  userId: string,
): Promise<Restaurant> {
  await removeVoteFromAll(sessionId, userId);
  const restaurant = await getRestaurantById(restaurantId, sessionId);
  if (!restaurant) throw new Error(`Restaurant ${restaurantId} not found`);
  const updated: Restaurant = { ...restaurant, votes: [...restaurant.votes, userId] };
  const { resource } = await container()
    .item(restaurantId, sessionId)
    .replace(updated as unknown as ItemDefinition);
  return resource as unknown as Restaurant;
}
