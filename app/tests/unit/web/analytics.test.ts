// Mock the Cosmos repositories before importing the analytics layer.
jest.mock('../../../src/db/repositories/sessionRepo', () => ({
  getAllSessionsForGuild: jest.fn(),
}));
jest.mock('../../../src/db/repositories/participantRepo', () => ({
  getParticipantsForSession: jest.fn(),
}));
jest.mock('../../../src/db/repositories/restaurantRepo', () => ({
  getRestaurantsForSession: jest.fn(),
}));
jest.mock('../../../src/db/repositories/carpoolRepo', () => ({
  getCarpoolsForSession: jest.fn(),
}));

import {
  buildHistory,
  buildRestaurantInsights,
  buildAttendanceInsights,
  buildTransportInsights,
  buildMusterInsights,
  buildAnalyticsSummaryForGuilds,
  type SessionBundle,
} from '../../../src/web/analytics';
import * as sessionRepo from '../../../src/db/repositories/sessionRepo';
import * as participantRepo from '../../../src/db/repositories/participantRepo';
import * as restaurantRepo from '../../../src/db/repositories/restaurantRepo';
import * as carpoolRepo from '../../../src/db/repositories/carpoolRepo';
import {
  SessionStatus,
  AttendanceStatus,
  TransportStatus,
  type LunchSession,
  type Participant,
  type Restaurant,
  type Carpool,
} from '../../../src/types';

function session(over: Partial<LunchSession> = {}): LunchSession {
  return {
    id: 's1',
    guildId: 'g1',
    channelId: 'c1',
    messageId: 'm1',
    creatorId: 'u1',
    date: '2026-01-01',
    lunchTime: '11:15',
    departTime: '11:00',
    status: SessionStatus.Completed,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function participant(over: Partial<Participant> = {}): Participant {
  return {
    id: `${over.sessionId ?? 's1'}::${over.userId ?? 'u1'}`,
    sessionId: 's1',
    userId: 'u1',
    username: 'user1',
    displayName: 'User One',
    attendanceStatus: AttendanceStatus.In,
    transportStatus: TransportStatus.None,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function restaurant(over: Partial<Restaurant> = {}): Restaurant {
  return {
    id: 'r1',
    sessionId: 's1',
    name: 'Tacos',
    addedBy: 'u1',
    votes: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function carpool(over: Partial<Carpool> = {}): Carpool {
  return {
    id: 's1::u1',
    sessionId: 's1',
    driverId: 'u1',
    seats: 3,
    musterPoint: 'Garage A',
    riders: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('buildHistory', () => {
  it('resolves the winning restaurant and counts In attendees', () => {
    const bundle: SessionBundle = {
      session: session({ lockedRestaurantId: 'r1' }),
      participants: [
        participant({ userId: 'a', attendanceStatus: AttendanceStatus.In }),
        participant({ userId: 'b', attendanceStatus: AttendanceStatus.In }),
        participant({ userId: 'c', attendanceStatus: AttendanceStatus.Out }),
      ],
      restaurants: [restaurant({ id: 'r1', name: 'Tacos' })],
      carpools: [],
    };
    const [row] = buildHistory([bundle]);
    expect(row.winningRestaurant).toBe('Tacos');
    expect(row.attendeeCount).toBe(2);
  });

  it('reports null winner when there is no lock and no votes', () => {
    const [row] = buildHistory([{ session: session(), participants: [], restaurants: [], carpools: [] }]);
    expect(row.winningRestaurant).toBeNull();
    expect(row.winnerByVote).toBe(false);
  });

  it('falls back to the top-voted restaurant when none is locked', () => {
    const bundle: SessionBundle = {
      session: session({ lockedRestaurantId: undefined }),
      participants: [],
      restaurants: [
        restaurant({ id: 'r1', name: 'Tacos', votes: ['a'] }),
        restaurant({ id: 'r2', name: 'Pizza', votes: ['b', 'c'] }),
      ],
      carpools: [],
    };
    const [row] = buildHistory([bundle]);
    expect(row.winningRestaurant).toBe('Pizza');
    expect(row.winnerByVote).toBe(true);
  });

  it('reports null winner on an unbroken tie', () => {
    const bundle: SessionBundle = {
      session: session({ lockedRestaurantId: undefined }),
      participants: [],
      restaurants: [
        restaurant({ id: 'r1', name: 'Tacos', votes: ['a'] }),
        restaurant({ id: 'r2', name: 'Pizza', votes: ['b'] }),
      ],
      carpools: [],
    };
    const [row] = buildHistory([bundle]);
    expect(row.winningRestaurant).toBeNull();
  });

  it('prefers the explicit lock over the vote leader', () => {
    const bundle: SessionBundle = {
      session: session({ lockedRestaurantId: 'r1' }),
      participants: [],
      restaurants: [
        restaurant({ id: 'r1', name: 'Tacos', votes: ['a'] }),
        restaurant({ id: 'r2', name: 'Pizza', votes: ['b', 'c'] }),
      ],
      carpools: [],
    };
    const [row] = buildHistory([bundle]);
    expect(row.winningRestaurant).toBe('Tacos');
    expect(row.winnerByVote).toBe(false);
  });
});

describe('buildRestaurantInsights', () => {
  it('aggregates votes, proposals, and win rate across sessions by name', () => {
    const bundles: SessionBundle[] = [
      {
        session: session({ id: 's1', lockedRestaurantId: 'r1' }),
        participants: [],
        restaurants: [restaurant({ id: 'r1', name: 'Tacos', votes: ['a', 'b'] })],
        carpools: [],
      },
      {
        session: session({ id: 's2', lockedRestaurantId: 'r3' }),
        participants: [],
        restaurants: [
          restaurant({ id: 'r2', name: 'Tacos', votes: ['c'] }),
          restaurant({ id: 'r3', name: 'Pizza', votes: ['d', 'e'] }),
        ],
        carpools: [],
      },
    ];
    const insights = buildRestaurantInsights(bundles);
    const tacos = insights.find((r) => r.name === 'Tacos')!;
    expect(tacos.totalVotes).toBe(3);
    expect(tacos.timesProposed).toBe(2);
    expect(tacos.wins).toBe(1);
    expect(tacos.winRate).toBeCloseTo(0.5);
    const pizza = insights.find((r) => r.name === 'Pizza')!;
    expect(pizza.wins).toBe(1);
    expect(pizza.winRate).toBe(1);
  });

  it('credits a win to the vote leader when no restaurant was locked', () => {
    const bundles: SessionBundle[] = [
      {
        session: session({ id: 's1', lockedRestaurantId: undefined }),
        participants: [],
        restaurants: [
          restaurant({ id: 'r1', name: 'Tacos', votes: ['a'] }),
          restaurant({ id: 'r2', name: 'Pizza', votes: ['b', 'c'] }),
        ],
        carpools: [],
      },
    ];
    const insights = buildRestaurantInsights(bundles);
    expect(insights.find((r) => r.name === 'Pizza')!.wins).toBe(1);
    expect(insights.find((r) => r.name === 'Tacos')!.wins).toBe(0);
  });
});

describe('buildAttendanceInsights', () => {
  it('computes per-session counts and per-user attendance rate', () => {
    const bundles: SessionBundle[] = [
      {
        session: session({ id: 's1', date: '2026-01-01' }),
        participants: [
          participant({ userId: 'a', attendanceStatus: AttendanceStatus.In }),
          participant({ userId: 'b', attendanceStatus: AttendanceStatus.Out }),
        ],
        restaurants: [],
        carpools: [],
      },
      {
        session: session({ id: 's2', date: '2026-01-02' }),
        participants: [participant({ userId: 'a', attendanceStatus: AttendanceStatus.In })],
        restaurants: [],
        carpools: [],
      },
    ];
    const insights = buildAttendanceInsights(bundles);
    expect(insights.perSession).toHaveLength(2);
    expect(insights.perSession[0]).toMatchObject({ date: '2026-01-01', in: 1, out: 1 });
    const a = insights.perUser.find((u) => u.userId === 'a')!;
    expect(a.sessions).toBe(2);
    expect(a.inCount).toBe(2);
    expect(a.attendanceRate).toBe(1);
  });
});

describe('buildTransportInsights', () => {
  it('ranks drivers and counts solo drivers and unassigned riders', () => {
    const bundles: SessionBundle[] = [
      {
        session: session(),
        participants: [
          participant({ userId: 'd1', displayName: 'Driver One', transportStatus: TransportStatus.CanDrive }),
          participant({ userId: 's', transportStatus: TransportStatus.DrivingAlone }),
          participant({ userId: 'r', transportStatus: TransportStatus.NeedRide }),
        ],
        restaurants: [],
        carpools: [carpool({ driverId: 'd1', seats: 3, riders: ['x', 'y'] })],
      },
    ];
    const t = buildTransportInsights(bundles);
    expect(t.drivers[0]).toMatchObject({ userId: 'd1', ridesGiven: 2, seatsOffered: 3, timesDriving: 1 });
    expect(t.totalRidesGiven).toBe(2);
    expect(t.soloDriverInstances).toBe(1);
    expect(t.unassignedRiderInstances).toBe(1);
  });
});

describe('buildMusterInsights', () => {
  it('counts muster point usage descending', () => {
    const bundles: SessionBundle[] = [
      { session: session(), participants: [], restaurants: [], carpools: [carpool({ driverId: 'a', musterPoint: 'Garage A' })] },
      { session: session(), participants: [], restaurants: [], carpools: [
        carpool({ driverId: 'b', musterPoint: 'Garage B' }),
        carpool({ driverId: 'c', musterPoint: 'Garage A' }),
      ] },
    ];
    const m = buildMusterInsights(bundles);
    expect(m[0]).toEqual({ musterPoint: 'Garage A', count: 2 });
  });
});

describe('buildAnalyticsSummaryForGuilds', () => {
  it('merges bundles across multiple guilds', async () => {
    (sessionRepo.getAllSessionsForGuild as jest.Mock).mockImplementation(async (g: string) =>
      g === 'g1' ? [session({ id: 's1', guildId: 'g1' })] : [session({ id: 's2', guildId: 'g2' })],
    );
    (participantRepo.getParticipantsForSession as jest.Mock).mockResolvedValue([]);
    (restaurantRepo.getRestaurantsForSession as jest.Mock).mockResolvedValue([]);
    (carpoolRepo.getCarpoolsForSession as jest.Mock).mockResolvedValue([]);

    const summary = await buildAnalyticsSummaryForGuilds(['g1', 'g2']);
    expect(summary.totalSessions).toBe(2);
    expect(summary.history).toHaveLength(2);
  });
});
