import { ItemDefinition } from '@azure/cosmos';
import { getDatabase, CONTAINERS } from '../cosmosClient.js';
import type { Participant } from '../../types/index.js';
import { AttendanceStatus, TransportStatus } from '../../types/index.js';

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

/** Returns participants who have not RSVPed — used for Ping Unanswered (BR-012). */
export async function getUnansweredUserIds(
  sessionId: string,
  allGuildMemberIds: string[],
): Promise<string[]> {
  const participants = await getParticipantsForSession(sessionId);
  const answeredIds = new Set(participants.map((p) => p.userId));
  return allGuildMemberIds.filter((id) => !answeredIds.has(id));
}

/**
 * Update a participant's attendance status.
 * Setting Out or Maybe clears transport status — you can't commit to a transport
 * mode if you might not be going (BR-rule: transport only valid when In).
 */
export async function updateAttendanceStatus(
  sessionId: string,
  userId: string,
  username: string,
  displayName: string,
  status: AttendanceStatus,
): Promise<Participant> {
  const existing = await getParticipant(sessionId, userId);
  const now = new Date().toISOString();

  // Out or Maybe → clear transport entirely; transport only valid when In
  const clearTransport = status === AttendanceStatus.Out || status === AttendanceStatus.Maybe;

  const participant: Participant = existing
    ? {
        ...existing,
        attendanceStatus: status,
        transportStatus: clearTransport ? TransportStatus.None : existing.transportStatus,
        assignedDriverId: clearTransport ? undefined : existing.assignedDriverId,
        updatedAt: now,
      }
    : {
        id: `${sessionId}::${userId}`,
        sessionId,
        userId,
        username,
        displayName,
        attendanceStatus: status,
        transportStatus: TransportStatus.None,
        updatedAt: now,
      };
  return upsertParticipant(participant);
}

/**
 * Update a participant's transport status.
 * Setting any non-None transport status on a user who is Out/Maybe/unset
 * auto-promotes their attendance to In (can't drive or ride if not going).
 * Setting None clears transport and leaves attendance unchanged.
 */
export async function updateTransportStatus(
  sessionId: string,
  userId: string,
  username: string,
  displayName: string,
  transport: TransportStatus,
): Promise<Participant> {
  const existing = await getParticipant(sessionId, userId);
  const now = new Date().toISOString();

  const requiresIn = transport !== TransportStatus.None;
  const currentAttendance = existing?.attendanceStatus;
  const shouldPromoteToIn =
    requiresIn &&
    (!currentAttendance ||
      currentAttendance === AttendanceStatus.Out ||
      currentAttendance === AttendanceStatus.Maybe);

  const participant: Participant = existing
    ? {
        ...existing,
        transportStatus: transport,
        attendanceStatus: shouldPromoteToIn ? AttendanceStatus.In : existing.attendanceStatus,
        // Clear assignedDriverId when no longer NeedRide
        assignedDriverId:
          transport === TransportStatus.NeedRide ? existing.assignedDriverId : undefined,
        updatedAt: now,
      }
    : {
        id: `${sessionId}::${userId}`,
        sessionId,
        userId,
        username,
        displayName,
        attendanceStatus: requiresIn ? AttendanceStatus.In : AttendanceStatus.Out,
        transportStatus: transport,
        updatedAt: now,
      };
  return upsertParticipant(participant);
}
