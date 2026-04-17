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

/**
 * Returns the single active (planning or locked) session for a guild, or null.
 * Only returns sessions dated today or in the future — past sessions are never
 * considered active even if they were never explicitly completed.
 */
export async function getActiveSessionForGuild(guildId: string): Promise<LunchSession | null> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const query: SqlQuerySpec = {
    query: `SELECT * FROM c
            WHERE c.guildId = @guildId
              AND (c.status = 'planning' OR c.status = 'locked')
              AND c.date >= @today`,
    parameters: [
      { name: '@guildId', value: guildId },
      { name: '@today', value: today },
    ],
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

/** Returns completed sessions for a guild, newest first. Defaults to 10. */
export async function getCompletedSessionsForGuild(
  guildId: string,
  limit = 10,
): Promise<LunchSession[]> {
  const query: SqlQuerySpec = {
    query: `SELECT TOP @limit * FROM c WHERE c.guildId = @guildId AND c.status = 'completed' ORDER BY c.createdAt DESC`,
    parameters: [
      { name: '@guildId', value: guildId },
      { name: '@limit', value: limit },
    ],
  };
  const { resources } = await container().items.query<LunchSession>(query).fetchAll();
  return resources;
}
/**
 * Mark stale planning/locked sessions as completed (BR-005).
 * A session is stale if its date has already passed (primary) OR it was created
 * more than 24 h ago (safety net for sessions with bad/missing date values).
 */
export async function expireOldSessions(): Promise<void> {
  // today as YYYY-MM-DD (UTC) — sessions dated before today are definitely over
  const today = new Date().toISOString().slice(0, 10);
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const query: SqlQuerySpec = {
    query: `SELECT * FROM c
            WHERE (c.status = 'planning' OR c.status = 'locked')
              AND (c.date < @today OR c.createdAt < @cutoff24h)`,
    parameters: [
      { name: '@today', value: today },
      { name: '@cutoff24h', value: cutoff24h },
    ],
  };
  const { resources } = await container().items.query<LunchSession>(query).fetchAll();
  const now = new Date().toISOString();
  await Promise.all(
    resources.map((s) =>
      container()
        .item(s.id, s.guildId)
        .replace({ ...s, status: 'completed' as SessionStatus, updatedAt: now } as unknown as ItemDefinition),
    ),
  );
}
