import { isCreatorOrAdmin, isAdmin } from '../../../src/utils/permissions';
import { LunchSession, SessionStatus } from '../../../src/types';
import { PermissionFlagsBits } from 'discord.js';

const mockSession: LunchSession = {
  id: 'sess-1',
  guildId: 'guild-1',
  channelId: 'chan-1',
  messageId: 'msg-1',
  creatorId: 'user-creator',
  date: '2026-03-29',
  lunchTime: '11:15',
  departTime: '11:00',
  status: SessionStatus.Planning,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function makeMember(flags: bigint[]) {
  return {
    permissions: {
      has: (flag: bigint) => flags.includes(flag),
    },
  } as any;
}

describe('isCreatorOrAdmin', () => {
  it('returns true for the session creator', () => {
    expect(isCreatorOrAdmin('user-creator', null, mockSession)).toBe(true);
  });

  it('returns true for a member with Administrator permission', () => {
    const member = makeMember([PermissionFlagsBits.Administrator]);
    expect(isCreatorOrAdmin('user-other', member, mockSession)).toBe(true);
  });

  it('returns true for a member with ManageGuild permission', () => {
    const member = makeMember([PermissionFlagsBits.ManageGuild]);
    expect(isCreatorOrAdmin('user-other', member, mockSession)).toBe(true);
  });

  it('returns false for a regular member who is not the creator', () => {
    const member = makeMember([]);
    expect(isCreatorOrAdmin('user-other', member, mockSession)).toBe(false);
  });

  it('returns false when member is null and user is not creator', () => {
    expect(isCreatorOrAdmin('user-other', null, mockSession)).toBe(false);
  });
});

describe('isAdmin', () => {
  it('returns true for Administrator', () => {
    expect(isAdmin(makeMember([PermissionFlagsBits.Administrator]))).toBe(true);
  });

  it('returns false for null member', () => {
    expect(isAdmin(null)).toBe(false);
  });
});
