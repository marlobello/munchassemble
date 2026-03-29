import { buildSessionEmbed, buildActionRows, format12h, BTN } from '../../../src/ui/panelBuilder';
import { LunchSession, Participant, Restaurant, SessionStatus, AttendanceStatus, ParticipantRole } from '../../../src/types';

const mockSession: LunchSession = {
  id: 'sess-1',
  guildId: 'guild-1',
  channelId: 'chan-1',
  messageId: 'msg-1',
  creatorId: 'user-1',
  date: '2026-03-29',
  lunchTime: '11:15',
  departTime: '11:00',
  status: SessionStatus.Planning,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockParticipants: Participant[] = [
  {
    id: 'sess-1::user-1',
    sessionId: 'sess-1',
    userId: 'user-1',
    username: 'alice',
    displayName: 'Alice',
    attendanceStatus: AttendanceStatus.In,
    role: ParticipantRole.None,
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'sess-1::user-2',
    sessionId: 'sess-1',
    userId: 'user-2',
    username: 'bob',
    displayName: 'Bob',
    attendanceStatus: AttendanceStatus.Maybe,
    role: ParticipantRole.None,
    updatedAt: new Date().toISOString(),
  },
];

const mockRestaurants: Restaurant[] = [
  {
    id: 'sess-1::r-1',
    sessionId: 'sess-1',
    name: 'Chipotle',
    addedBy: 'user-1',
    votes: ['user-1', 'user-2'],
    createdAt: new Date().toISOString(),
  },
  {
    id: 'sess-1::r-2',
    sessionId: 'sess-1',
    name: 'Local Table',
    addedBy: 'user-2',
    votes: ['user-3'],
    createdAt: new Date().toISOString(),
  },
];

describe('buildSessionEmbed', () => {
  it('includes the session date in the title', () => {
    const embed = buildSessionEmbed(mockSession, mockParticipants, mockRestaurants);
    const data = embed.toJSON();
    expect(data.title).toContain('MUNCH ASSEMBLE');
  });

  it('shows correct attendance counts in field names', () => {
    const embed = buildSessionEmbed(mockSession, mockParticipants, mockRestaurants);
    const fields = embed.toJSON().fields ?? [];
    const inField = fields.find((f) => f.name.startsWith('✅ In'));
    const maybeField = fields.find((f) => f.name.startsWith('🤔 Maybe'));
    expect(inField?.name).toBe('✅ In (1)');
    expect(maybeField?.name).toBe('🤔 Maybe (1)');
  });

  it('lists restaurants sorted by vote count descending', () => {
    const embed = buildSessionEmbed(mockSession, mockParticipants, mockRestaurants);
    const fields = embed.toJSON().fields ?? [];
    const restaurantField = fields.find((f) => f.name.includes('Restaurant'));
    expect(restaurantField?.value).toMatch(/Chipotle.*Local Table/s);
  });

  it('shows "🔒 FINALIZED" title when session is locked', () => {
    const lockedSession: LunchSession = { ...mockSession, status: SessionStatus.Locked };
    const embed = buildSessionEmbed(lockedSession, mockParticipants, mockRestaurants);
    expect(embed.toJSON().title).toContain('FINALIZED');
  });
});

describe('buildActionRows', () => {
  it('returns 3 rows for a planning session', () => {
    const rows = buildActionRows(mockSession);
    expect(rows).toHaveLength(3);
  });

  it('returns 1 row (disabled) for a locked session', () => {
    const lockedSession: LunchSession = { ...mockSession, status: SessionStatus.Locked };
    const rows = buildActionRows(lockedSession);
    expect(rows).toHaveLength(1);
  });

  it('generates correct customIds for attendance buttons', () => {
    const rows = buildActionRows(mockSession);
    const buttons = (rows[0].toJSON() as any).components;
    expect(buttons[0].custom_id).toBe(BTN.in('sess-1'));
    expect(buttons[1].custom_id).toBe(BTN.maybe('sess-1'));
    expect(buttons[2].custom_id).toBe(BTN.out('sess-1'));
  });
});

describe('format12h', () => {
  it('converts 11:15 to 11:15 AM', () => {
    expect(format12h('11:15')).toBe('11:15 AM');
  });

  it('converts 13:00 to 1:00 PM', () => {
    expect(format12h('13:00')).toBe('1:00 PM');
  });

  it('converts 00:00 to 12:00 AM', () => {
    expect(format12h('00:00')).toBe('12:00 AM');
  });

  it('converts 12:00 to 12:00 PM', () => {
    expect(format12h('12:00')).toBe('12:00 PM');
  });
});
