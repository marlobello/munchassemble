// Mock Cosmos DB before importing services
jest.mock('../../../src/db/repositories/sessionRepo', () => ({
  createSession: jest.fn(async (s) => s),
  getActiveSessionForGuild: jest.fn(async () => null),
  updateSession: jest.fn(async (s) => ({ ...s, updatedAt: new Date().toISOString() })),
  expireOldSessions: jest.fn(async () => undefined),
  getCompletedSessionsForGuild: jest.fn(async () => []),
}));

jest.mock('../../../src/db/repositories/restaurantRepo', () => ({
  createRestaurant: jest.fn(async (r) => r),
  getRestaurantsForSession: jest.fn(async () => []),
  getRestaurantById: jest.fn(async () => null),
  castVote: jest.fn(),
  removeVoteFromAll: jest.fn(),
}));

import { startSession, completeSession, getCompletedSessionsForGuild, finalizeSession } from '../../../src/services/sessionService';
import { addRestaurant, pickWinningRestaurant } from '../../../src/services/restaurantService';
import * as sessionRepo from '../../../src/db/repositories/sessionRepo';
import * as restaurantRepo from '../../../src/db/repositories/restaurantRepo';
import { SessionStatus } from '../../../src/types';

function makeSession(over = {}) {
  return {
    id: 's1', guildId: 'g1', channelId: 'c1', messageId: 'm1', creatorId: 'u1',
    date: '2026-05-10', lunchTime: '11:15', departTime: '11:00',
    status: SessionStatus.Planning, createdAt: '2026-05-10T00:00:00.000Z',
    updatedAt: '2026-05-10T00:00:00.000Z', ...over,
  };
}

function makeRestaurant(over = {}) {
  return { id: 'r1', sessionId: 's1', name: 'Tacos', addedBy: 'u1', votes: [], createdAt: '2026-05-10T00:00:00.000Z', ...over };
}

describe('pickWinningRestaurant', () => {
  it('returns the most-voted restaurant', () => {
    const r = pickWinningRestaurant([
      makeRestaurant({ id: 'r1', votes: ['a'] }),
      makeRestaurant({ id: 'r2', votes: ['b', 'c'] }),
    ]);
    expect(r?.id).toBe('r2');
  });

  it('returns null when there are no votes', () => {
    expect(pickWinningRestaurant([makeRestaurant({ votes: [] })])).toBeNull();
    expect(pickWinningRestaurant([])).toBeNull();
  });

  it('breaks ties deterministically by createdAt', () => {
    const r = pickWinningRestaurant([
      makeRestaurant({ id: 'r2', votes: ['b'], createdAt: '2026-05-10T02:00:00.000Z' }),
      makeRestaurant({ id: 'r1', votes: ['a'], createdAt: '2026-05-10T01:00:00.000Z' }),
    ]);
    expect(r?.id).toBe('r1');
  });
});

describe('sessionService.finalizeSession', () => {
  beforeEach(() => jest.clearAllMocks());

  it('auto-locks the top-voted restaurant when none is locked', async () => {
    (restaurantRepo.getRestaurantsForSession as jest.Mock).mockResolvedValueOnce([
      makeRestaurant({ id: 'r1', votes: ['a'] }),
      makeRestaurant({ id: 'r2', votes: ['b', 'c'] }),
    ]);
    const result = await finalizeSession(makeSession());
    expect(result.status).toBe(SessionStatus.Locked);
    expect(result.lockedRestaurantId).toBe('r2');
  });

  it('preserves an already-locked restaurant', async () => {
    const result = await finalizeSession(makeSession({ lockedRestaurantId: 'r9' }));
    expect(result.lockedRestaurantId).toBe('r9');
    expect(restaurantRepo.getRestaurantsForSession).not.toHaveBeenCalled();
  });

  it('finalizes without a lock when there are no votes', async () => {
    (restaurantRepo.getRestaurantsForSession as jest.Mock).mockResolvedValueOnce([
      makeRestaurant({ id: 'r1', votes: [] }),
    ]);
    const result = await finalizeSession(makeSession());
    expect(result.status).toBe(SessionStatus.Locked);
    expect(result.lockedRestaurantId).toBeUndefined();
  });
});

describe('sessionService.startSession', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a session with planning status', async () => {
    const session = await startSession({
      guildId: 'guild-1',
      channelId: 'chan-1',
      creatorId: 'user-1',
      date: '2026-03-29',
      lunchTime: '11:15',
      departTime: '11:00',
    });
    expect(session.status).toBe(SessionStatus.Planning);
    expect(session.guildId).toBe('guild-1');
  });

  it('throws when a still-planning session already exists', async () => {
    (sessionRepo.getActiveSessionForGuild as jest.Mock).mockResolvedValueOnce({
      id: 'existing',
      date: '2026-03-29',
      status: SessionStatus.Planning,
    });
    await expect(
      startSession({
        guildId: 'guild-1',
        channelId: 'chan-1',
        creatorId: 'user-1',
        date: '2026-03-29',
        lunchTime: '11:15',
        departTime: '11:00',
      }),
    ).rejects.toThrow(/already active/);
  });

  it('auto-completes a finalized (locked) session and creates a new one', async () => {
    (sessionRepo.getActiveSessionForGuild as jest.Mock).mockResolvedValueOnce({
      id: 'old-locked',
      guildId: 'guild-1',
      date: '2026-03-29',
      status: SessionStatus.Locked,
    });
    const session = await startSession({
      guildId: 'guild-1',
      channelId: 'chan-1',
      creatorId: 'user-1',
      date: '2026-03-29',
      lunchTime: '11:15',
      departTime: '11:00',
    });
    // The old locked session is retired via updateSession(status=completed)
    const completedCall = (sessionRepo.updateSession as jest.Mock).mock.calls.find(
      ([s]) => s.id === 'old-locked',
    );
    expect(completedCall?.[0].status).toBe(SessionStatus.Completed);
    // And a fresh planning session is created
    expect(session.status).toBe(SessionStatus.Planning);
    expect(sessionRepo.createSession as jest.Mock).toHaveBeenCalled();
  });
});

describe('restaurantService.addRestaurant', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a restaurant with empty votes', async () => {
    const result = await addRestaurant('sess-1', 'Chipotle', 'user-1');
    expect(result.name).toBe('Chipotle');
    expect(result.votes).toEqual([]);
  });
});

describe('sessionService.completeSession', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sets status to completed without a _ttl', async () => {
    const session = {
      id: 'sess-1',
      guildId: 'guild-1',
      channelId: 'chan-1',
      messageId: 'msg-1',
      creatorId: 'user-1',
      date: '2026-03-29',
      lunchTime: '11:15',
      departTime: '11:00',
      status: SessionStatus.Locked,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await completeSession(session);
    const [calledWith] = (sessionRepo.updateSession as jest.Mock).mock.calls[0];
    expect(calledWith.status).toBe(SessionStatus.Completed);
    expect(calledWith._ttl).toBeUndefined();
  });
});

describe('sessionService.getCompletedSessionsForGuild', () => {
  beforeEach(() => jest.clearAllMocks());

  it('delegates to repo and returns results', async () => {
    const mockSessions = [{ id: 's1', guildId: 'guild-1', status: SessionStatus.Completed }];
    (sessionRepo.getCompletedSessionsForGuild as jest.Mock).mockResolvedValueOnce(mockSessions);
    const result = await getCompletedSessionsForGuild('guild-1', 5);
    expect(result).toEqual(mockSessions);
    expect(sessionRepo.getCompletedSessionsForGuild).toHaveBeenCalledWith('guild-1', 5);
  });
});
