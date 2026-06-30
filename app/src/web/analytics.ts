// app/src/web/analytics.ts
// Read-only analytics aggregation layer for the Phase 4 web app (ADR-0006).
// Reuses the existing Cosmos repositories — it never mutates coordination data
// (BR-076). Computes the historical insights described in BRD BR-071..BR-075.

import { getAllSessionsForGuild } from '../db/repositories/sessionRepo.js';
import { getParticipantsForSession } from '../db/repositories/participantRepo.js';
import { getRestaurantsForSession } from '../db/repositories/restaurantRepo.js';
import { getCarpoolsForSession } from '../db/repositories/carpoolRepo.js';
import type { LunchSession, Participant, Restaurant, Carpool } from '../types/index.js';
import { AttendanceStatus, TransportStatus } from '../types/index.js';

/** A session joined with all of its child records. */
export interface SessionBundle {
  session: LunchSession;
  participants: Participant[];
  restaurants: Restaurant[];
  carpools: Carpool[];
}

/** One row in the session history view (BR-071). */
export interface SessionHistoryRow {
  id: string;
  date: string;
  status: string;
  lunchTime: string;
  departTime: string;
  winningRestaurant: string | null;
  attendeeCount: number;
}

/** Restaurant leaderboard entry (BR-072). */
export interface RestaurantInsight {
  name: string;
  totalVotes: number;
  timesProposed: number;
  wins: number;
  winRate: number; // wins / timesProposed, 0..1
}

/** Attendance over time + per-user reliability (BR-073). */
export interface AttendanceInsights {
  perSession: { date: string; in: number; maybe: number; out: number }[];
  perUser: {
    userId: string;
    displayName: string;
    sessions: number;
    inCount: number;
    maybeCount: number;
    outCount: number;
    attendanceRate: number; // inCount / sessions, 0..1
  }[];
}

/** Driver / carpool statistics (BR-074). */
export interface TransportInsights {
  drivers: {
    userId: string;
    displayName: string;
    timesDriving: number;
    seatsOffered: number;
    ridesGiven: number;
  }[];
  soloDriverInstances: number;
  totalRidesGiven: number;
  unassignedRiderInstances: number;
}

/** Muster point usage distribution (BR-075). */
export interface MusterInsight {
  musterPoint: string;
  count: number;
}

/** Top-level payload rendered by the dashboard. */
export interface AnalyticsSummary {
  guildId: string;
  totalSessions: number;
  history: SessionHistoryRow[];
  restaurants: RestaurantInsight[];
  attendance: AttendanceInsights;
  transport: TransportInsights;
  muster: MusterInsight[];
}

/** Fetch every session for a guild together with its child records. */
export async function loadSessionBundles(guildId: string): Promise<SessionBundle[]> {
  const sessions = await getAllSessionsForGuild(guildId);
  return Promise.all(
    sessions.map(async (session) => {
      const [participants, restaurants, carpools] = await Promise.all([
        getParticipantsForSession(session.id),
        getRestaurantsForSession(session.id),
        getCarpoolsForSession(session.id),
      ]);
      return { session, participants, restaurants, carpools };
    }),
  );
}

function bestDisplayName(p: Participant): string {
  return p.displayName || p.username || p.userId;
}

export function buildHistory(bundles: SessionBundle[]): SessionHistoryRow[] {
  return bundles.map(({ session, participants, restaurants }) => {
    const locked = session.lockedRestaurantId
      ? restaurants.find((r) => r.id === session.lockedRestaurantId)
      : undefined;
    const attendeeCount = participants.filter(
      (p) => p.attendanceStatus === AttendanceStatus.In,
    ).length;
    return {
      id: session.id,
      date: session.date,
      status: session.status,
      lunchTime: session.lunchTime,
      departTime: session.departTime,
      winningRestaurant: locked?.name ?? null,
      attendeeCount,
    };
  });
}

export function buildRestaurantInsights(bundles: SessionBundle[]): RestaurantInsight[] {
  const byName = new Map<string, RestaurantInsight>();

  for (const { session, restaurants } of bundles) {
    for (const r of restaurants) {
      const key = r.name.trim();
      const entry =
        byName.get(key) ??
        { name: key, totalVotes: 0, timesProposed: 0, wins: 0, winRate: 0 };
      entry.totalVotes += r.votes.length;
      entry.timesProposed += 1;
      if (session.lockedRestaurantId === r.id) entry.wins += 1;
      byName.set(key, entry);
    }
  }

  const list = [...byName.values()];
  for (const e of list) {
    e.winRate = e.timesProposed > 0 ? e.wins / e.timesProposed : 0;
  }
  // Most-voted first, then most-proposed.
  return list.sort(
    (a, b) => b.totalVotes - a.totalVotes || b.timesProposed - a.timesProposed,
  );
}

export function buildAttendanceInsights(bundles: SessionBundle[]): AttendanceInsights {
  // Oldest → newest for time-series readability.
  const ordered = [...bundles].sort((a, b) =>
    a.session.date.localeCompare(b.session.date),
  );

  const perSession = ordered.map(({ session, participants }) => ({
    date: session.date,
    in: participants.filter((p) => p.attendanceStatus === AttendanceStatus.In).length,
    maybe: participants.filter((p) => p.attendanceStatus === AttendanceStatus.Maybe).length,
    out: participants.filter((p) => p.attendanceStatus === AttendanceStatus.Out).length,
  }));

  const perUserMap = new Map<
    string,
    { userId: string; displayName: string; sessions: number; inCount: number; maybeCount: number; outCount: number }
  >();

  for (const { participants } of bundles) {
    for (const p of participants) {
      const entry =
        perUserMap.get(p.userId) ??
        {
          userId: p.userId,
          displayName: bestDisplayName(p),
          sessions: 0,
          inCount: 0,
          maybeCount: 0,
          outCount: 0,
        };
      entry.displayName = bestDisplayName(p); // keep the most recent name
      entry.sessions += 1;
      if (p.attendanceStatus === AttendanceStatus.In) entry.inCount += 1;
      else if (p.attendanceStatus === AttendanceStatus.Maybe) entry.maybeCount += 1;
      else if (p.attendanceStatus === AttendanceStatus.Out) entry.outCount += 1;
      perUserMap.set(p.userId, entry);
    }
  }

  const perUser = [...perUserMap.values()]
    .map((e) => ({
      ...e,
      attendanceRate: e.sessions > 0 ? e.inCount / e.sessions : 0,
    }))
    .sort((a, b) => b.inCount - a.inCount || b.attendanceRate - a.attendanceRate);

  return { perSession, perUser };
}

export function buildTransportInsights(bundles: SessionBundle[]): TransportInsights {
  const driverMap = new Map<
    string,
    { userId: string; displayName: string; timesDriving: number; seatsOffered: number; ridesGiven: number }
  >();
  let soloDriverInstances = 0;
  let totalRidesGiven = 0;
  let unassignedRiderInstances = 0;

  for (const { participants, carpools } of bundles) {
    const nameById = new Map(participants.map((p) => [p.userId, bestDisplayName(p)]));

    for (const c of carpools) {
      const entry =
        driverMap.get(c.driverId) ??
        {
          userId: c.driverId,
          displayName: nameById.get(c.driverId) ?? c.driverId,
          timesDriving: 0,
          seatsOffered: 0,
          ridesGiven: 0,
        };
      entry.displayName = nameById.get(c.driverId) ?? entry.displayName;
      entry.timesDriving += 1;
      entry.seatsOffered += c.seats;
      entry.ridesGiven += c.riders.length;
      driverMap.set(c.driverId, entry);
      totalRidesGiven += c.riders.length;
    }

    // Solo drivers: participants who declared DrivingAlone.
    soloDriverInstances += participants.filter(
      (p) => p.transportStatus === TransportStatus.DrivingAlone,
    ).length;

    // Riders needing a ride but not assigned to any driver.
    unassignedRiderInstances += participants.filter(
      (p) => p.transportStatus === TransportStatus.NeedRide && !p.assignedDriverId,
    ).length;
  }

  const drivers = [...driverMap.values()].sort(
    (a, b) => b.ridesGiven - a.ridesGiven || b.timesDriving - a.timesDriving,
  );

  return { drivers, soloDriverInstances, totalRidesGiven, unassignedRiderInstances };
}

export function buildMusterInsights(bundles: SessionBundle[]): MusterInsight[] {
  const counts = new Map<string, number>();
  for (const { carpools } of bundles) {
    for (const c of carpools) {
      const key = (c.musterPoint || '').trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([musterPoint, count]) => ({ musterPoint, count }))
    .sort((a, b) => b.count - a.count);
}

/** Build the full analytics summary for a guild (BR-071..BR-075). */
export async function buildAnalyticsSummary(guildId: string): Promise<AnalyticsSummary> {
  const bundles = await loadSessionBundles(guildId);
  return summarizeBundles(guildId, bundles);
}

/**
 * Build a combined analytics summary across several guilds (the app may gate more than
 * one guild — see DISCORD_GUILD_ID). Bundles from every guild are merged.
 */
export async function buildAnalyticsSummaryForGuilds(guildIds: string[]): Promise<AnalyticsSummary> {
  const perGuild = await Promise.all(guildIds.map((g) => loadSessionBundles(g)));
  const bundles = perGuild.flat();
  return summarizeBundles(guildIds.join(','), bundles);
}

function summarizeBundles(guildId: string, bundles: SessionBundle[]): AnalyticsSummary {
  return {
    guildId,
    totalSessions: bundles.length,
    history: buildHistory(bundles),
    restaurants: buildRestaurantInsights(bundles),
    attendance: buildAttendanceInsights(bundles),
    transport: buildTransportInsights(bundles),
    muster: buildMusterInsights(bundles),
  };
}
