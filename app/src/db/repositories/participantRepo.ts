import { ItemDefinition } from '@azure/cosmos';
import { getDatabase, CONTAINERS } from '../cosmosClient.js';
import type { Participant } from '../../types/index.js';
import { AttendanceStatus } from '../../types/index.js';

const container = () => getDatabase().container(CONTAINERS.participants);

export async function upsertParticipant(participant: Participant): Promise<Participant> {
  const { resource } = await container().items.upsert(participant as unknown as ItemDefinition);
  return resource as unknown as Participant;
}

export async function getParticipantsForSession(sessionId: string): Promise<Participant[]> {
  const { resources } = await container()
    .items.query<Participant>({
      query: 'SELECT * FROM c WHERE c.sessionId = @sessionId',
      parameters: [{ name: '@sessionId', value: sessionId }],
    })
    .fetchAll();
  return resources;
}

export async function getParticipant(
  sessionId: string,
  userId: string,
): Promise<Participant | null> {
  const id = `${sessionId}::${userId}`;
  try {
    const { resource } = await container().item(id, sessionId).read<Participant>();
    return resource ?? null;
  } catch {
    return null;
  }
}

/** Returns participants who have not RSVPed (not in/maybe/out) — used for Ping Unanswered (BR-012). */
export async function getUnansweredUserIds(
  sessionId: string,
  allGuildMemberIds: string[],
): Promise<string[]> {
  const participants = await getParticipantsForSession(sessionId);
  const answeredIds = new Set(participants.map((p) => p.userId));
  return allGuildMemberIds.filter((id) => !answeredIds.has(id));
}

export async function updateAttendanceStatus(
  sessionId: string,
  userId: string,
  username: string,
  displayName: string,
  status: AttendanceStatus,
): Promise<Participant> {
  const existing = await getParticipant(sessionId, userId);
  const now = new Date().toISOString();
  const participant: Participant = existing
    ? {
        ...existing,
        attendanceStatus: status,
        // Driving alone means no muster point needed — clear it
        musterPoint: status === AttendanceStatus.DrivingAlone ? undefined : existing.musterPoint,
        updatedAt: now,
      }
    : {
        id: `${sessionId}::${userId}`,
        sessionId,
        userId,
        username,
        displayName,
        attendanceStatus: status,
        role: 'none' as Participant['role'],
        updatedAt: now,
      };
  return upsertParticipant(participant);
}
