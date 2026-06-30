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
  getLocalToday,
} from '../db/repositories/sessionRepo.js';
import { getRestaurantsForSession } from '../db/repositories/restaurantRepo.js';
import { pickWinningRestaurant } from './restaurantService.js';

export interface CreateSessionInput {
  guildId: string;
  channelId: string;
  creatorId: string;
  date: string;
  lunchTime: string;
  departTime: string;
  notes?: string;
}

/**
 * Creates a new session. Throws if a still-planning session is active for the
 * guild (BR-001). A previously **finalized** (locked) session does not block a
 * new one — it is auto-completed here to free the slot.
 */
export async function startSession(
  input: CreateSessionInput,
  messageId = '',
): Promise<LunchSession> {
  const existing = await getActiveSessionForGuild(input.guildId);
  if (existing) {
    if (existing.status === SessionStatus.Planning) {
      throw new Error(
        `A session is already active for this server (started on ${existing.date}). Finalize or cancel it first.`,
      );
    }
    // existing.status === Locked (finalized) — retire it so the new one is unambiguous
    await completeSession(existing);
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

/**
 * Finalize (lock) a session (BR-004). If no restaurant was explicitly locked yet,
 * automatically lock the highest-voted one (BR-023) so the finalized plan always has a
 * chosen restaurant when votes exist. Sessions with no votes finalize without a lock.
 */
export async function finalizeSession(session: LunchSession): Promise<LunchSession> {
  let lockedRestaurantId = session.lockedRestaurantId;
  if (!lockedRestaurantId) {
    const restaurants = await getRestaurantsForSession(session.id);
    const winner = pickWinningRestaurant(restaurants);
    if (winner) lockedRestaurantId = winner.id;
  }
  return updateSession({ ...session, status: SessionStatus.Locked, lockedRestaurantId });
}

export async function cancelSession(session: LunchSession): Promise<LunchSession> {
  return updateSession({ ...session, status: SessionStatus.Cancelled });
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

export { getActiveSessionForGuild, expireOldSessions, getCompletedSessionsForGuild, getSessionById, getLocalToday };
