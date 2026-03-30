import type { Participant, AttendanceStatus, TransportStatus } from '../types/index.js';
import {
  updateAttendanceStatus,
  updateTransportStatus,
  getParticipantsForSession,
  getUnansweredUserIds,
} from '../db/repositories/participantRepo.js';

export async function rsvp(
  sessionId: string,
  userId: string,
  username: string,
  displayName: string,
  status: AttendanceStatus,
): Promise<Participant> {
  return updateAttendanceStatus(sessionId, userId, username, displayName, status);
}

/** Set a participant's transport status. Auto-promotes to In if currently Out/Maybe. */
export async function setTransport(
  sessionId: string,
  userId: string,
  username: string,
  displayName: string,
  transport: TransportStatus,
): Promise<Participant> {
  return updateTransportStatus(sessionId, userId, username, displayName, transport);
}

export { getParticipantsForSession, getUnansweredUserIds };
