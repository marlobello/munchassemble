// Mock the noping repo before importing the module under test.
jest.mock('../../../src/db/repositories/noPingRepo', () => ({
  getNoPingListForGuild: jest.fn(async () => []),
}));

import type { Client } from 'discord.js';
import { fetchNoResponseNames } from '../../../src/utils/panelRefresh';
import type { Participant } from '../../../src/types';
import { AttendanceStatus, TransportStatus } from '../../../src/types';
import * as noPingRepo from '../../../src/db/repositories/noPingRepo';

// ── Helpers ───────────────────────────────────────────────────────────────────

interface FakeMember {
  id: string;
  displayName: string;
  user: { bot: boolean };
}

function makeMember(id: string, displayName: string, bot = false): FakeMember {
  return { id, displayName, user: { bot } };
}

function makeParticipant(userId: string): Participant {
  return {
    id: `sess::${userId}`,
    sessionId: 'sess',
    userId,
    username: userId,
    displayName: userId,
    attendanceStatus: AttendanceStatus.In,
    transportStatus: TransportStatus.None,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Builds a fake discord.js Client whose member cache is backed by a Map.
 * `fetchImpl` simulates guild.members.fetch() (e.g. re-populating the Map).
 */
function makeClient(
  guildId: string,
  cache: Map<string, FakeMember>,
  fetchImpl?: () => Promise<unknown>,
): Client {
  const guild = {
    members: {
      cache,
      fetch: jest.fn(fetchImpl ?? (async () => cache)),
    },
  };
  return {
    guilds: { cache: new Map([[guildId, guild]]) },
  } as unknown as Client;
}

beforeEach(() => {
  jest.clearAllMocks();
  (noPingRepo.getNoPingListForGuild as jest.Mock).mockResolvedValue([]);
});

describe('fetchNoResponseNames', () => {
  it('returns non-bot, non-participant, non-noping members sorted by display name', async () => {
    const cache = new Map<string, FakeMember>([
      ['u1', makeMember('u1', 'Charlie')],
      ['u2', makeMember('u2', 'Andy')],
      ['u3', makeMember('u3', 'Bot', true)],
      ['u4', makeMember('u4', 'Beth')],
    ]);
    const client = makeClient('g1', cache);

    const result = await fetchNoResponseNames('g1', [makeParticipant('u1')], client);

    // u1 responded (participant), u3 is a bot → only Andy + Beth remain, sorted.
    expect(result).toEqual(['Andy', 'Beth']);
  });

  it('excludes members on the noping list', async () => {
    (noPingRepo.getNoPingListForGuild as jest.Mock).mockResolvedValue([
      { guildId: 'g-noping', userId: 'u2' },
    ]);
    const cache = new Map<string, FakeMember>([
      ['u1', makeMember('u1', 'Andy')],
      ['u2', makeMember('u2', 'Silenced')],
    ]);
    const client = makeClient('g-noping', cache);

    const result = await fetchNoResponseNames('g-noping', [], client);

    expect(result).toEqual(['Andy']);
  });

  it('re-fetches the roster when the member cache is empty, then returns names', async () => {
    const cache = new Map<string, FakeMember>();
    // fetch() simulates discord.js repopulating the cache after a resume.
    const client = makeClient('g-empty', cache, async () => {
      cache.set('u1', makeMember('u1', 'Andy'));
      cache.set('u2', makeMember('u2', 'Beth'));
      return cache;
    });

    const result = await fetchNoResponseNames('g-empty', [], client);

    const guild = client.guilds.cache.get('g-empty')!;
    expect(guild.members.fetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual(['Andy', 'Beth']);
  });

  it('returns [] when the cache is empty and the re-fetch yields nothing', async () => {
    const cache = new Map<string, FakeMember>();
    const client = makeClient('g-stillempty', cache, async () => cache);

    const result = await fetchNoResponseNames('g-stillempty', [], client);

    const guild = client.guilds.cache.get('g-stillempty')!;
    expect(guild.members.fetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
  });

  it('does not re-fetch again within the cooldown window', async () => {
    const cache = new Map<string, FakeMember>();
    const client = makeClient('g-cooldown', cache, async () => cache);

    await fetchNoResponseNames('g-cooldown', [], client);
    await fetchNoResponseNames('g-cooldown', [], client);

    const guild = client.guilds.cache.get('g-cooldown')!;
    // Second call is within the cooldown → fetch is skipped.
    expect(guild.members.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns [] when the guild is not cached', async () => {
    const client = { guilds: { cache: new Map() } } as unknown as Client;
    const result = await fetchNoResponseNames('missing', [], client);
    expect(result).toEqual([]);
  });
});
