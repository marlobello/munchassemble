// Mock Cosmos DB before importing services
jest.mock('../../../src/db/repositories/sessionRepo', () => ({
  createSession: jest.fn(async (s) => s),
  getActiveSessionForGuild: jest.fn(async () => null),
  updateSession: jest.fn(async (s) => ({ ...s, updatedAt: new Date().toISOString() })),
  expireOldSessions: jest.fn(async () => undefined),
}));

jest.mock('../../../src/db/repositories/restaurantRepo', () => ({
  createRestaurant: jest.fn(async (r) => r),
  getRestaurantsForSession: jest.fn(async () => []),
  getRestaurantById: jest.fn(async () => null),
  castVote: jest.fn(),
  removeVoteFromAll: jest.fn(),
}));

jest.mock('../../../src/db/repositories/favoriteRepo', () => ({
  recordUsage: jest.fn(async () => undefined),
  getTopFavorites: jest.fn(async () => []),
}));

import { startSession, getActiveSessionForGuild } from '../../../src/services/sessionService';
import { addRestaurant } from '../../../src/services/restaurantService';
import * as sessionRepo from '../../../src/db/repositories/sessionRepo';
import { SessionStatus } from '../../../src/types';

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

  it('throws when an active session already exists', async () => {
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
});

describe('restaurantService.addRestaurant', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a restaurant with empty votes', async () => {
    const result = await addRestaurant('sess-1', 'guild-1', 'Chipotle', 'user-1');
    expect(result.name).toBe('Chipotle');
    expect(result.votes).toEqual([]);
  });
});
