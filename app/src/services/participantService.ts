import type { Participant, AttendanceStatus } from '../types/index.js';
import {
  updateAttendanceStatus,
  updateDrivingAlone,
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

export async function toggleDrivingAlone(
  sessionId: string,
  userId: string,
  username: string,
  displayName: string,
): Promise<Participant> {
  return updateDrivingAlone(sessionId, userId, username, displayName);
}

export { getParticipantsForSession, getUnansweredUserIds };
