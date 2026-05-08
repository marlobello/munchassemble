import { buildNotificationSummary } from '../../../src/utils/notificationBuilder';
import { AttendanceStatus, TransportStatus, SessionStatus } from '../../../src/types';
import type { LunchSession, Participant, Restaurant, Carpool } from '../../../src/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<LunchSession> = {}): LunchSession {
  return {
    id: 'sess-1',
    guildId: 'guild-1',
    channelId: 'chan-1',
    messageId: 'msg-1',
    creatorId: 'user-1',
    date: '2026-05-08',
    lunchTime: '11:15',
    departTime: '11:00',
    status: SessionStatus.Locked,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeParticipant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'sess-1::user-1',
    sessionId: 'sess-1',
    userId: 'user-1',
    username: 'alice',
    displayName: 'Alice',
    attendanceStatus: AttendanceStatus.In,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRestaurant(overrides: Partial<Restaurant> = {}): Restaurant {
  return {
    id: 'rest-1',
    sessionId: 'sess-1',
    name: 'Taco Palace',
    addedBy: 'user-1',
    votes: ['user-1'],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeCarpool(overrides: Partial<Carpool> = {}): Carpool {
  return {
    id: 'sess-1::driver-1',
    sessionId: 'sess-1',
    driverId: 'driver-1',
    seats: 3,
    musterPoint: 'Lobby',
    riders: [],
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildNotificationSummary', () => {
  it('includes header, restaurant, times, and attendance', () => {
    const session = makeSession({ lockedRestaurantId: 'rest-1' });
    const participants = [makeParticipant()];
    const restaurants = [makeRestaurant()];

    const result = buildNotificationSummary(session, participants, restaurants, [], '🔒 **Plan finalized!**');

    expect(result).toContain('🔒 **Plan finalized!**');
    expect(result).toContain('Taco Palace');
    expect(result).toContain('11:00 AM');
    expect(result).toContain('11:15 AM');
    expect(result).toContain('Alice');
    expect(result).toContain('Going (1)');
  });

  it('includes carpool details with driver, muster point, and riders', () => {
    const session = makeSession({ lockedRestaurantId: 'rest-1' });
    const driver = makeParticipant({
      id: 'sess-1::driver-1',
      userId: 'driver-1',
      username: 'dave',
      displayName: 'Dave',
      transportStatus: TransportStatus.CanDrive,
    });
    const rider = makeParticipant({
      id: 'sess-1::rider-1',
      userId: 'rider-1',
      username: 'rachel',
      displayName: 'Rachel',
      transportStatus: TransportStatus.NeedRide,
      assignedDriverId: 'driver-1',
    });
    const carpool = makeCarpool({ riders: ['rider-1'] });

    const result = buildNotificationSummary(
      session,
      [driver, rider],
      [makeRestaurant()],
      [carpool],
      '⏰ **T-15 Reminder**',
    );

    expect(result).toContain('Transportation');
    expect(result).toContain('Dave');
    expect(result).toContain('Lobby');
    expect(result).toContain('Rachel');
    expect(result).toContain('2 seat');
  });

  it('includes solo drivers', () => {
    const solo = makeParticipant({
      userId: 'solo-1',
      displayName: 'Sam',
      transportStatus: TransportStatus.DrivingAlone,
    });

    const result = buildNotificationSummary(
      makeSession({ lockedRestaurantId: 'rest-1' }),
      [solo],
      [makeRestaurant()],
      [],
      'Header',
    );

    expect(result).toContain('Driving alone');
    expect(result).toContain('Sam');
  });

  it('includes unassigned riders', () => {
    const rider = makeParticipant({
      userId: 'rider-1',
      displayName: 'Riley',
      transportStatus: TransportStatus.NeedRide,
      // no assignedDriverId
    });

    const result = buildNotificationSummary(
      makeSession({ lockedRestaurantId: 'rest-1' }),
      [rider],
      [makeRestaurant()],
      [],
      'Header',
    );

    expect(result).toContain('Still need a ride');
    expect(result).toContain('Riley');
  });

  it('omits transportation section when no transport data', () => {
    const participant = makeParticipant({ transportStatus: TransportStatus.None });

    const result = buildNotificationSummary(
      makeSession({ lockedRestaurantId: 'rest-1' }),
      [participant],
      [makeRestaurant()],
      [],
      'Header',
    );

    expect(result).not.toContain('Transportation');
  });

  it('falls back to top-voted restaurant when none is locked', () => {
    const session = makeSession(); // no lockedRestaurantId
    const r1 = makeRestaurant({ id: 'r1', name: 'Burger Barn', votes: ['a'] });
    const r2 = makeRestaurant({ id: 'r2', name: 'Pizza Place', votes: ['a', 'b', 'c'] });

    const result = buildNotificationSummary(session, [], [r1, r2], [], 'Header');

    expect(result).toContain('Pizza Place');
  });
});
