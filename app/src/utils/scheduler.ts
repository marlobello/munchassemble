import cron from 'node-cron';
import type { Client, TextBasedChannel } from 'discord.js';
import type { LunchSession } from '../types/index.js';
import { AttendanceStatus, TransportStatus, SessionStatus } from '../types/index.js';
import { getParticipantsForSession } from '../services/participantService.js';
import { getRestaurantsForSession } from '../services/restaurantService.js';
import { getCarpoolsForSession } from '../services/carpoolService.js';
import { getActiveSessionForGuild, finalizeSession, completeSession, getSessionById } from '../services/sessionService.js';
import { refreshPanelMessage } from './panelRefresh.js';
import { format12h } from '../ui/panelBuilder.js';

// Map from sessionId to scheduled tasks
const _jobs = new Map<string, cron.ScheduledTask[]>();

/**
 * Schedule T-15 and T-5 reminder jobs for a session, plus an auto-complete
 * job that fires after lunchTime to move the session to Completed.
 * Safe to call multiple times — cancels existing jobs first.
 */
export function scheduleReminders(session: LunchSession, client: Client): void {
  cancelReminders(session.id);

  const [datePart] = session.date.split('T');
  const [departH, departM] = session.departTime.split(':').map(Number);
  const [lunchH, lunchM] = session.lunchTime.split(':').map(Number);

  const t15 = computeReminderTime(datePart, departH, departM, 15);
  const t5 = computeReminderTime(datePart, departH, departM, 5);
  // Auto-complete 60 min after lunch time (session is well and truly over)
  const autoComplete = computeAbsoluteTime(datePart, lunchH, lunchM, 60);

  const jobs: cron.ScheduledTask[] = [];

  if (t15) {
    const task = cron.schedule(t15, async () => {
      await sendT15Reminder(session, client);
      task.stop();
    });
    jobs.push(task);
    console.log(`[scheduler] T-15 reminder scheduled for session ${session.id} at ${t15}`);
  }

  if (t5) {
    const task = cron.schedule(t5, async () => {
      await sendT5Reminder(session, client);
      task.stop();
    });
    jobs.push(task);
    console.log(`[scheduler] T-5 reminder scheduled for session ${session.id} at ${t5}`);
  }

  if (autoComplete) {
    const task = cron.schedule(autoComplete, async () => {
      await autoCompleteSession(session);
      task.stop();
    });
    jobs.push(task);
    console.log(`[scheduler] Auto-complete scheduled for session ${session.id} at ${autoComplete}`);
  }

  if (jobs.length > 0) {
    _jobs.set(session.id, jobs);
  }
}

/** Cancel and remove any scheduled jobs for a session. */
export function cancelReminders(sessionId: string): void {
  const jobs = _jobs.get(sessionId);
  if (jobs) {
    jobs.forEach((j) => j.stop());
    _jobs.delete(sessionId);
    console.log(`[scheduler] Cancelled reminders for session ${sessionId}`);
  }
}

/** Build a node-cron expression for N minutes before departure. Returns null if time has passed. */
function computeReminderTime(
  date: string,
  departH: number,
  departM: number,
  minutesBefore: number,
): string | null {
  const totalMinutes = departH * 60 + departM - minutesBefore;
  if (totalMinutes < 0) return null;

  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;

  // Check if the time has already passed today
  const [y, mo, d] = date.split('-').map(Number);
  const reminderTime = new Date(y, mo - 1, d, h, m, 0);
  if (reminderTime <= new Date()) return null;

  return `${m} ${h} ${d} ${mo} *`;
}

/**
 * Build a node-cron expression for an absolute time (base + offsetMinutes after).
 * Returns null if the resulting time has already passed.
 */
function computeAbsoluteTime(
  date: string,
  baseH: number,
  baseM: number,
  offsetMinutes: number,
): string | null {
  const totalMinutes = baseH * 60 + baseM + offsetMinutes;
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;

  const [y, mo, d] = date.split('-').map(Number);
  const fireTime = new Date(y, mo - 1, d, h, m, 0);
  if (fireTime <= new Date()) return null;

  return `${m} ${h} ${d} ${mo} *`;
}

/** Auto-complete a session after the lunch has ended. */
async function autoCompleteSession(session: LunchSession): Promise<void> {
  try {
    // Re-fetch to get current status — may have been manually completed already
    const current = await getSessionById(session.id, session.guildId);
    if (!current || current.status === SessionStatus.Completed) return;
    await completeSession(current);
    console.log(`[scheduler] Auto-completed session ${session.id}`);
  } catch (err) {
    console.error(`[scheduler] Failed to auto-complete session ${session.id}:`, err);
  }
}

async function sendT15Reminder(session: LunchSession, client: Client): Promise<void> {
  const rawChannel = client.channels.cache.get(session.channelId);
  if (!rawChannel?.isTextBased()) return;
  // PartialGroupDMChannel lacks `send` — guard to guild text channels only
  const channel = rawChannel as TextBasedChannel;
  if (!('send' in channel)) return;

  // Auto-finalize if still in planning status (BR-064)
  let activeSession = await getActiveSessionForGuild(session.guildId);
  if (!activeSession || activeSession.id !== session.id) return; // session already completed

  if (activeSession.status === SessionStatus.Planning) {
    try {
      activeSession = await finalizeSession(activeSession);
      await refreshPanelMessage(activeSession, client);
      console.log(`[scheduler] Auto-finalized session ${activeSession.id} at T-15`);
    } catch (err) {
      console.error(`[scheduler] Failed to auto-finalize session ${activeSession.id}:`, err);
      // Continue to send reminder even if finalize fails
    }
  }

  const [participants, restaurants, carpools] = await Promise.all([
    getParticipantsForSession(activeSession.id),
    getRestaurantsForSession(activeSession.id),
    getCarpoolsForSession(activeSession.id),
  ]);

  const restaurant = activeSession.lockedRestaurantId
    ? restaurants.find((r) => r.id === activeSession.lockedRestaurantId)
    : restaurants.sort((a, b) => b.votes.length - a.votes.length)[0];

  const inList = participants.filter((p) => p.attendanceStatus === AttendanceStatus.In);
  const drivers = participants.filter((p) => p.transportStatus === TransportStatus.CanDrive);

  let msg = `⏰ **T-15 Reminder — Munch Assemble!**\n`;
  msg += `🍔 **Restaurant:** ${restaurant?.name ?? 'TBD'}\n`;
  msg += `🚀 **Departure in 15 minutes** at ${format12h(activeSession.departTime)}\n`;
  msg += `🕐 **Lunch:** ${format12h(activeSession.lunchTime)}\n`;
  msg += `👥 **Going (${inList.length}):** ${inList.map((p) => `<@${p.userId}>`).join(', ') || 'No one yet!'}\n`;

  if (drivers.length > 0) {
    msg += `\n🚗 **Drivers:**\n`;
    for (const driver of drivers) {
      const carpool = carpools.find((c) => c.driverId === driver.userId);
      if (carpool) {
        const riderMentions = carpool.riders.map((id) => `<@${id}>`).join(', ') || 'No riders assigned';
        msg += `  • <@${driver.userId}> from **${carpool.musterPoint}** — ${riderMentions}\n`;
      }
    }
  }

  await channel.send(msg);
}

async function sendT5Reminder(session: LunchSession, client: Client): Promise<void> {
  const rawChannel = client.channels.cache.get(session.channelId);
  if (!rawChannel?.isTextBased()) return;
  const channel = rawChannel as TextBasedChannel;
  if (!('send' in channel)) return;

  const [participants, restaurants, carpools] = await Promise.all([
    getParticipantsForSession(session.id),
    getRestaurantsForSession(session.id),
    getCarpoolsForSession(session.id),
  ]);

  const restaurant = session.lockedRestaurantId
    ? restaurants.find((r) => r.id === session.lockedRestaurantId)
    : restaurants.sort((a, b) => b.votes.length - a.votes.length)[0];

  const inList = participants.filter((p) => p.attendanceStatus === AttendanceStatus.In);
  const riders = participants.filter(
    (p) => p.transportStatus === TransportStatus.NeedRide && !p.assignedDriverId,
  );

  let msg = `🚨 **FINAL CALL — 5 minutes to departure!**\n`;
  msg += `🍔 **Restaurant:** ${restaurant?.name ?? 'TBD'}\n`;
  msg += `🚀 **Depart:** ${format12h(session.departTime)} | **Lunch:** ${format12h(session.lunchTime)}\n`;
  msg += `👥 **Going (${inList.length}):** ${inList.map((p) => `<@${p.userId}>`).join(', ')}\n`;

  const driverCount = carpools.length;
  if (driverCount > 0) {
    const totalSeats = carpools.reduce((sum, c) => sum + c.seats, 0);
    const totalRiders = carpools.reduce((sum, c) => sum + c.riders.length, 0);
    msg += `🚗 **Carpools:** ${driverCount} driver${driverCount !== 1 ? 's' : ''}, ${totalSeats} seats, ${totalRiders} assigned\n`;
  }

  if (riders.length > 0) {
    msg += `⚠️ **Still need rides:** ${riders.map((r) => `<@${r.userId}>`).join(', ')}\n`;
  }

  await channel.send(msg);
}
