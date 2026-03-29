import type { Participant, AttendanceStatus } from '../types/index.js';
import {
  updateAttendanceStatus,
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

export { getParticipantsForSession, getUnansweredUserIds };
