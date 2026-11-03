jest.mock('../../../src/services/sessionService', () => ({
  getActiveSessionForGuild: jest.fn(async () => null),
}));

import cron from 'node-cron';
import type { Client } from 'discord.js';
import { scheduleReminders, cancelReminders, cancelAllReminders } from '../../../src/utils/scheduler';
import { getActiveSessionForGuild } from '../../../src/services/sessionService';
import { SessionStatus, type LunchSession } from '../../../src/types';

const session: LunchSession = {
  id: 'scheduled-session',
  guildId: 'guild',
  channelId: 'channel',
  messageId: 'message',
  creatorId: 'creator',
  date: '2026-11-04',
  departTime: '11:00',
  lunchTime: '11:15',
  status: SessionStatus.Planning,
  createdAt: '2026-11-04T10:00:00',
  updatedAt: '2026-11-04T10:00:00',
};

const client = {
  channels: {
    cache: new Map([['channel', { isTextBased: () => true, send: jest.fn() }]]),
  },
} as unknown as Client;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-04T10:00:00'));
  jest.clearAllMocks();
});

afterEach(() => {
  cancelAllReminders();
  jest.useRealTimers();
});

describe('reminder task lifecycle', () => {
  it('destroys replaced and cancelled tasks instead of retaining stopped cron registrations', () => {
    scheduleReminders(session, client);
    const previous = [...cron.getTasks().values()];
    expect(previous).toHaveLength(3);

    scheduleReminders({ ...session, departTime: '11:30' }, client);
    expect(previous.every((task) => task.getStatus() === 'destroyed')).toBe(true);
    expect(cron.getTasks().size).toBe(3);

    cancelReminders(session.id);
    expect(cron.getTasks().size).toBe(0);
  });

  it('removes a reminder after its single execution even when the session is no longer active', async () => {
    jest.setSystemTime(new Date('2026-11-04T10:44:59'));
    scheduleReminders(session, client);

    await jest.advanceTimersByTimeAsync(1500);

    expect(getActiveSessionForGuild).toHaveBeenCalledTimes(1);
    expect(cron.getTasks().size).toBe(2);
  });

  it('cancels every session without leaving callbacks or cron registrations behind', async () => {
    scheduleReminders(session, client);
    scheduleReminders({ ...session, id: 'another-session' }, client);
    expect(cron.getTasks().size).toBe(6);

    cancelAllReminders();
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(cron.getTasks().size).toBe(0);
    expect(getActiveSessionForGuild).not.toHaveBeenCalled();
  });
});
