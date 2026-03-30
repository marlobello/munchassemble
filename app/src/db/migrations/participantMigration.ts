import { getDatabase, CONTAINERS } from '../cosmosClient.js';

/**
 * One-shot startup migration for legacy Participant documents.
 *
 * Handles records written before the TransportStatus refactor:
 *   attendanceStatus='driving_alone'  → attendanceStatus='in', transportStatus='driving_alone'
 *   drivingAlone=true                 → transportStatus='driving_alone' (if not already set)
 *   role='driver'                     → transportStatus='can_drive'     (if not already set)
 *   role='rider'                      → transportStatus='need_ride'     (if not already set)
 *
 * Legacy fields (role, drivingAlone, musterPoint) are stripped from every
 * matched document so they are never re-read by the application.
 *
 * Safe to run on every startup — no-ops when no legacy records exist.
 */
export async function migrateParticipantLegacyFields(): Promise<void> {
  const container = getDatabase().container(CONTAINERS.participants);

  // Query only documents that still carry legacy fields
  const { resources } = await container.items
    .query<Record<string, unknown>>({
      query: `SELECT * FROM c
              WHERE c.attendanceStatus = 'driving_alone'
                 OR IS_DEFINED(c.role)
                 OR c.drivingAlone = true
                 OR IS_DEFINED(c.musterPoint)`,
    })
    .fetchAll();

  if (resources.length === 0) {
    return; // Nothing to migrate
  }

  console.log(`[migration] Migrating ${resources.length} legacy participant record(s)...`);
  const now = new Date().toISOString();

  await Promise.all(
    resources.map(async (raw) => {
      let attendanceStatus = (raw.attendanceStatus as string) ?? 'out';
      let transportStatus = (raw.transportStatus as string) ?? 'none';

      // attendanceStatus='driving_alone' was the old way of recording solo driving
      if (attendanceStatus === 'driving_alone') {
        attendanceStatus = 'in';
        transportStatus = 'driving_alone';
      } else if (transportStatus === 'none') {
        // Promote legacy boolean / role fields if no transport status yet
        if (raw.drivingAlone === true) {
          transportStatus = 'driving_alone';
        } else if (raw.role === 'driver') {
          transportStatus = 'can_drive';
        } else if (raw.role === 'rider') {
          transportStatus = 'need_ride';
        }
      }

      // Reconstruct a clean document — omitting all legacy fields
      const clean: Record<string, unknown> = {
        id: raw.id,
        sessionId: raw.sessionId,
        userId: raw.userId,
        username: raw.username,
        displayName: raw.displayName,
        attendanceStatus,
        transportStatus,
        updatedAt: now,
      };

      if (raw.assignedDriverId) clean.assignedDriverId = raw.assignedDriverId;

      await container.item(raw.id as string, raw.sessionId as string).replace(clean);
    }),
  );

  console.log(`[migration] Done — ${resources.length} participant record(s) updated.`);
}
