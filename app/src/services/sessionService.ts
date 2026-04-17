import { randomUUID } from 'crypto';
import type { LunchSession } from '../types/index.js';
import { SessionStatus } from '../types/index.js';
import {
  createSession,
  getActiveSessionForGuild,
  updateSession,
  expireOldSessions,
  getCompletedSessionsForGuild,
  getSessionById,
} from '../db/repositories/sessionRepo.js';

export interface CreateSessionInput {
  guildId: string;
  channelId: string;
  creatorId: string;
  date: string;
  lunchTime: string;
  departTime: string;
  notes?: string;
  initialRestaurant?: string;
}

/** Creates a new session. Throws if one is already active for the guild (BR-001). */
export async function startSession(
  input: CreateSessionInput,
  messageId = '',
): Promise<LunchSession> {
  const existing = await getActiveSessionForGuild(input.guildId);
  if (existing) {
    throw new Error(
      `A session is already active for this server (started on ${existing.date}). Finalize it first.`,
    );
  }

  const now = new Date().toISOString();
  const session: LunchSession = {
    id: randomUUID(),
    guildId: input.guildId,
    channelId: input.channelId,
    messageId,
    creatorId: input.creatorId,
    date: input.date,
    lunchTime: input.lunchTime,
    departTime: input.departTime,
    notes: input.notes,
    status: SessionStatus.Planning,
    createdAt: now,
    updatedAt: now,
  };

  return createSession(session);
}

/** Update the messageId after posting the panel (BR-002 — we post panel after creating session). */
export async function attachMessageId(session: LunchSession, messageId: string): Promise<LunchSession> {
  return updateSession({ ...session, messageId });
}

export async function lockRestaurant(session: LunchSession, restaurantId: string): Promise<LunchSession> {
  if (session.status === SessionStatus.Locked) throw new Error('Session is already locked.');
  return updateSession({ ...session, lockedRestaurantId: restaurantId });
}

export async function finalizeSession(session: LunchSession): Promise<LunchSession> {
  return updateSession({ ...session, status: SessionStatus.Locked });
}

export async function completeSession(session: LunchSession): Promise<LunchSession> {
  return updateSession({ ...session, status: SessionStatus.Completed });
}

export async function updateSessionTimes(
  session: LunchSession,
  lunchTime: string,
  departTime: string,
): Promise<LunchSession> {
  return updateSession({ ...session, lunchTime, departTime });
}

export { getActiveSessionForGuild, expireOldSessions, getCompletedSessionsForGuild, getSessionById };
