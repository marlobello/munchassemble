import { MessageFlags } from 'discord.js';
import { buildPanel, format12h, BTN } from '../../../src/ui/panelBuilder';
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

describe('buildPanel (Components v2)', () => {
  it('sets IsComponentsV2 flag', () => {
    const { flags } = buildPanel(mockSession, mockParticipants, mockRestaurants);
    expect(flags).toBe(MessageFlags.IsComponentsV2);
  });

  it('returns a single Container component', () => {
    const { components } = buildPanel(mockSession, mockParticipants, mockRestaurants);
    expect(components).toHaveLength(1);
    expect((components[0] as any).toJSON().type).toBe(17); // Container type
  });

  it('panel content includes session title and date', () => {
    const { components } = buildPanel(mockSession, mockParticipants, mockRestaurants);
    const containerJson = (components[0] as any).toJSON();
    const textDisplay = containerJson.components[0]; // first child is TextDisplay
    expect(textDisplay.type).toBe(10); // TextDisplay type
    expect(textDisplay.content).toContain('MUNCH ASSEMBLE');
  });

  it('panel content shows correct attendance', () => {
    const { components } = buildPanel(mockSession, mockParticipants, mockRestaurants);
    const containerJson = (components[0] as any).toJSON();
    const textDisplay = containerJson.components[0];
    expect(textDisplay.content).toContain('In (1)');
    expect(textDisplay.content).toContain('Maybe (1)');
    expect(textDisplay.content).toContain('Alice');
    expect(textDisplay.content).toContain('Bob');
  });

  it('panel content lists restaurants sorted by votes descending', () => {
    const { components } = buildPanel(mockSession, mockParticipants, mockRestaurants);
    const containerJson = (components[0] as any).toJSON();
    const content: string = containerJson.components[0].content;
    expect(content.indexOf('Chipotle')).toBeLessThan(content.indexOf('Local Table'));
  });

  it('finalized panel has green accent color and no action rows', () => {
    const lockedSession: LunchSession = { ...mockSession, status: SessionStatus.Locked };
    const { components } = buildPanel(lockedSession, mockParticipants, mockRestaurants);
    const containerJson = (components[0] as any).toJSON();
    expect(containerJson.accent_color).toBe(0x57f287);
    // Only one child: the TextDisplay (no action rows when locked)
    expect(containerJson.components).toHaveLength(1);
    expect(containerJson.components[0].type).toBe(10);
  });

  it('planning panel has yellow accent color', () => {
    const { components } = buildPanel(mockSession, mockParticipants, mockRestaurants);
    const containerJson = (components[0] as any).toJSON();
    expect(containerJson.accent_color).toBe(0xfee75c);
  });

  // Validate action row custom IDs within the container
  function getActionRows(components: any[]) {
    const containerComponents = (components[0] as any).toJSON().components;
    return containerComponents.filter((c: any) => c.type === 1); // ActionRow type = 1
  }

  it('attendance row has correct button customIds', () => {
    const { components } = buildPanel(mockSession, mockParticipants, mockRestaurants);
    const rows = getActionRows(components);
    const btns = rows[0].components;
    expect(btns[0].custom_id).toBe(BTN.in('sess-1'));
    expect(btns[1].custom_id).toBe(BTN.maybe('sess-1'));
    expect(btns[2].custom_id).toBe(BTN.out('sess-1'));
  });

  it('transport row contains Driving Alone button', () => {
    const { components } = buildPanel(mockSession, mockParticipants, mockRestaurants);
    const rows = getActionRows(components);
    const transportBtns = rows[2].components; // row 0=attendance, 1=restaurant, 2=transport
    const ids = transportBtns.map((b: any) => b.custom_id);
    expect(ids).toContain(BTN.drivingAlone('sess-1'));
    expect(ids).toContain(BTN.driving('sess-1'));
    expect(ids).toContain(BTN.needRide('sess-1'));
  });

  it('admin row has correct button customIds', () => {
    const { components } = buildPanel(mockSession, mockParticipants, mockRestaurants);
    const rows = getActionRows(components);
    const adminBtns = rows[4].components; // row 4 = admin
    const ids = adminBtns.map((b: any) => b.custom_id);
    expect(ids).toContain(BTN.finalize('sess-1'));
    expect(ids).toContain(BTN.ping('sess-1'));
    expect(ids).toContain(BTN.editTime('sess-1'));
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
