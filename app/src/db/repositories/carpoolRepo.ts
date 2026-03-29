import { ItemDefinition } from '@azure/cosmos';
import { getDatabase, CONTAINERS } from '../cosmosClient.js';
import type { Carpool } from '../../types/index.js';

const container = () => getDatabase().container(CONTAINERS.carpools);

export async function upsertCarpool(carpool: Carpool): Promise<Carpool> {
  const { resource } = await container().items.upsert(carpool as unknown as ItemDefinition);
  return resource as unknown as Carpool;
}

export async function getCarpoolByDriver(sessionId: string, driverId: string): Promise<Carpool | null> {
  const id = `${sessionId}::${driverId}`;
  try {
    const { resource } = await container().item(id, sessionId).read<Carpool>();
    return resource ?? null;
  } catch {
    return null;
  }
}

export async function getCarpoolsForSession(sessionId: string): Promise<Carpool[]> {
  const { resources } = await container()
    .items.query<Carpool>({
      query: 'SELECT * FROM c WHERE c.sessionId = @sessionId',
      parameters: [{ name: '@sessionId', value: sessionId }],
    })
    .fetchAll();
  return resources;
}

export async function deleteCarpool(sessionId: string, driverId: string): Promise<void> {
  const id = `${sessionId}::${driverId}`;
  await container().item(id, sessionId).delete();
}
