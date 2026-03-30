import { ItemDefinition, SqlQuerySpec } from '@azure/cosmos';
import { getDatabase, CONTAINERS } from '../cosmosClient.js';
import type { LunchSession, SessionStatus } from '../../types/index.js';

const container = () => getDatabase().container(CONTAINERS.sessions);

export async function createSession(session: LunchSession): Promise<LunchSession> {
  const { resource } = await container().items.create(session as unknown as ItemDefinition);
  return resource as unknown as LunchSession;
}

export async function getSessionById(id: string, guildId: string): Promise<LunchSession | null> {
  try {
    const { resource } = await container().item(id, guildId).read<LunchSession>();
    return resource ?? null;
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code: number }).code === 404) {
      return null;
    }
    throw err;
  }
}

/** Returns the single active (planning or locked) session for a guild, or null. */
export async function getActiveSessionForGuild(guildId: string): Promise<LunchSession | null> {
  const query: SqlQuerySpec = {
    query: `SELECT * FROM c WHERE c.guildId = @guildId AND (c.status = 'planning' OR c.status = 'locked')`,
    parameters: [{ name: '@guildId', value: guildId }],
  };
  const { resources } = await container().items.query<LunchSession>(query).fetchAll();
  return resources[0] ?? null;
}

export async function updateSession(
  session: LunchSession,
): Promise<LunchSession> {
  const updated = { ...session, updatedAt: new Date().toISOString() };
  const { resource } = await container().item(session.id, session.guildId).replace(updated as unknown as ItemDefinition);
  return resource as unknown as LunchSession;
}

/** Mark all planning/locked sessions older than 24 h as completed (BR-005). */
export async function expireOldSessions(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const query: SqlQuerySpec = {
    query: `SELECT * FROM c WHERE (c.status = 'planning' OR c.status = 'locked') AND c.createdAt < @cutoff`,
    parameters: [{ name: '@cutoff', value: cutoff }],
  };
  const { resources } = await container().items.query<LunchSession>(query).fetchAll();
  const now = new Date().toISOString();
  const ttl = 30 * 24 * 60 * 60; // 30 days — auto-purge expired sessions from Cosmos
  await Promise.all(
    resources.map((s) =>
      container()
        .item(s.id, s.guildId)
        .replace({ ...s, status: 'completed' as SessionStatus, _ttl: ttl, updatedAt: now } as unknown as ItemDefinition),
    ),
  );
}
