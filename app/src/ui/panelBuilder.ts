import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { LunchSession, Participant, Restaurant, Carpool } from '../types/index.js';
import { AttendanceStatus, SessionStatus, ParticipantRole } from '../types/index.js';

// ─── Custom ID constants ──────────────────────────────────────────────────────
// Format: namespace:action:sessionId

export const BTN = {
  in: (sid: string) => `rsvp:in:${sid}`,
  maybe: (sid: string) => `rsvp:maybe:${sid}`,
  out: (sid: string) => `rsvp:out:${sid}`,
  drivingAlone: (sid: string) => `rsvp:driving_alone:${sid}`,
  vote: (sid: string) => `restaurant:vote:${sid}`,
  addSpot: (sid: string) => `restaurant:add:${sid}`,
  lockChoice: (sid: string) => `restaurant:lock:${sid}`,
  driving: (sid: string) => `carpool:driving:${sid}`,
  needRide: (sid: string) => `carpool:need_ride:${sid}`,
  carpoolSwitch: (sid: string) => `carpool:switch:${sid}`,
  autoAssign: (sid: string) => `carpool:auto_assign:${sid}`,
  muster: (sid: string) => `muster:pick:${sid}`,
  editTime: (sid: string) => `admin:edit_time:${sid}`,
  finalize: (sid: string) => `admin:finalize:${sid}`,
  ping: (sid: string) => `admin:ping:${sid}`,
} as const;

export const SELECT = {
  vote: (sid: string) => `select:vote:${sid}`,
  muster: (sid: string) => `muster:select:${sid}`,
  carpoolNeedRide: (sid: string) => `carpool:need_ride_select:${sid}`,
} as const;

// ─── Embed builder ────────────────────────────────────────────────────────────

export function buildSessionEmbed(
  session: LunchSession,
  participants: Participant[],
  restaurants: Restaurant[],
  carpools: Carpool[] = [],
): EmbedBuilder {
  const isLocked = session.status === SessionStatus.Locked;
  const title = isLocked ? '🔒 FINALIZED – MUNCH ASSEMBLE' : '🍔 MUNCH ASSEMBLE';

  const statusColor = isLocked ? 0x57f287 : 0xfee75c; // green locked, yellow planning

  // Attendance groups
  const inList = participants.filter((p) => p.attendanceStatus === AttendanceStatus.In);
  const maybeList = participants.filter((p) => p.attendanceStatus === AttendanceStatus.Maybe);
  const outList = participants.filter((p) => p.attendanceStatus === AttendanceStatus.Out);
  const soloList = participants.filter((p) => p.attendanceStatus === AttendanceStatus.DrivingAlone);

  const nameList = (ps: Participant[]) =>
    ps.length ? ps.map((p) => p.displayName).join(', ') : '*None yet*';

  // Restaurant leaderboard (sorted by vote count desc)
  const sorted = [...restaurants].sort((a, b) => b.votes.length - a.votes.length);
  const restaurantLines = sorted.length
    ? sorted
        .map((r, i) => {
          const locked = session.lockedRestaurantId === r.id;
          const prefix = locked ? '🔒' : `${i + 1}.`;
          return `${prefix} **${r.name}** — ${r.votes.length} vote${r.votes.length !== 1 ? 's' : ''}`;
        })
        .join('\n')
    : '*No options added yet*';

  const embed = new EmbedBuilder()
    .setTitle(`${title} – ${formatDate(session.date)}`)
    .setColor(statusColor)
    .addFields(
      {
        name: '📍 Restaurant (Voting)',
        value: restaurantLines,
        inline: false,
      },
      {
        name: `✅ In (${inList.length})`,
        value: nameList(inList),
        inline: true,
      },
      {
        name: `🤔 Maybe (${maybeList.length})`,
        value: nameList(maybeList),
        inline: true,
      },
      {
        name: `❌ Out (${outList.length})`,
        value: outList.length ? String(outList.length) : '*None*',
        inline: true,
      },
      {
        name: `🚘 Driving Alone (${soloList.length})`,
        value: soloList.length ? soloList.map((p) => p.displayName).join(', ') : '*None*',
        inline: true,
      },
      {
        name: '⏰ Timing',
        value: `**Lunch:** ${format12h(session.lunchTime)}  |  **Depart:** ${format12h(session.departTime)}`,
        inline: false,
      },
    );

  if (session.notes) {
    embed.addFields({ name: '📝 Notes', value: session.notes, inline: false });
  }

  // Carpool section (Phase 2)
  if (carpools.length > 0) {
    const carpoolLines = carpools.map((c) => {
      const driverParticipant = participants.find((p) => p.userId === c.driverId);
      const driverName = driverParticipant?.displayName ?? `<@${c.driverId}>`;
      const filled = c.riders.length;
      const riderNames = c.riders
        .map((rid) => participants.find((p) => p.userId === rid)?.displayName ?? `<@${rid}>`)
        .join(', ');
      return `🚗 **${driverName}** (${filled}/${c.seats} seats) @ ${c.musterPoint}${filled > 0 ? ` — ${riderNames}` : ''}`;
    });
    embed.addFields({
      name: '🚗 Carpools',
      value: carpoolLines.join('\n'),
      inline: false,
    });
  }

  // Muster points — exclude solo drivers (muster is irrelevant for them)
  const withMuster = participants.filter(
    (p) => p.musterPoint && p.attendanceStatus !== AttendanceStatus.DrivingAlone,
  );
  if (withMuster.length > 0) {
    // Group by muster point
    const grouped = withMuster.reduce<Record<string, string[]>>((acc, p) => {
      const key = p.musterPoint!;
      (acc[key] ??= []).push(p.displayName);
      return acc;
    }, {});
    const musterLines = Object.entries(grouped)
      .map(([point, names]) => `📍 **${point}:** ${names.join(', ')}`)
      .join('\n');
    embed.addFields({ name: '📍 Muster Points', value: musterLines, inline: false });
  }

  embed.setFooter({
    text: isLocked ? '🟢 Status: Finalized' : '🟡 Status: Planning',
  });

  return embed;
}

// ─── Action rows ──────────────────────────────────────────────────────────────

/** Row 1: Attendance buttons — always shown */
function buildAttendanceRow(sessionId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(BTN.in(sessionId))
      .setLabel("✅ I'm In")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(BTN.maybe(sessionId))
      .setLabel('🤔 Maybe')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(BTN.out(sessionId))
      .setLabel('❌ Out')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(BTN.drivingAlone(sessionId))
      .setLabel('🚘 Driving Alone')
      .setStyle(ButtonStyle.Secondary),
  );
}

/** Row 2: Restaurant buttons — disabled when session is locked */
function buildRestaurantRow(
  sessionId: string,
  locked: boolean,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(BTN.vote(sessionId))
      .setLabel('🍔 Vote')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(locked),
    new ButtonBuilder()
      .setCustomId(BTN.addSpot(sessionId))
      .setLabel('➕ Add Spot')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(locked),
    new ButtonBuilder()
      .setCustomId(BTN.lockChoice(sessionId))
      .setLabel('🔒 Lock Choice')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(locked),
  );
}

/** Row 3: Carpool buttons */
function buildCarpoolRow(sessionId: string, locked: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(BTN.driving(sessionId))
      .setLabel("🚗 I'm Driving")
      .setStyle(ButtonStyle.Success)
      .setDisabled(locked),
    new ButtonBuilder()
      .setCustomId(BTN.needRide(sessionId))
      .setLabel('🚌 Need Ride')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(locked),
    new ButtonBuilder()
      .setCustomId(BTN.carpoolSwitch(sessionId))
      .setLabel('🔄 Switch')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(locked),
    new ButtonBuilder()
      .setCustomId(BTN.autoAssign(sessionId))
      .setLabel('🤖 Auto Assign')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(locked),
  );
}

/** Row 4: Muster point button (opens select menu via ephemeral) */
function buildMusterRow(sessionId: string, locked: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(BTN.muster(sessionId))
      .setLabel('📍 Set Muster Point')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(locked),
  );
}

/** Row 5: Admin controls */
function buildAdminRow(sessionId: string, locked: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(BTN.finalize(sessionId))
      .setLabel('🔒 Finalize Plan')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(locked),
    new ButtonBuilder()
      .setCustomId(BTN.ping(sessionId))
      .setLabel('🔔 Ping Unanswered')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(BTN.editTime(sessionId))
      .setLabel('✏️ Edit Time')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(locked),
  );
}

/** Minimal locked-state action rows (BR-004). */
function buildLockedRows(_sessionId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('noop')
        .setLabel('👀 View above for details')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
    ),
  ];
}

/**
 * Build all action rows for the session panel (max 5 — Discord limit).
 * Switches to minimal rows when session is finalized (BR-004).
 */
export function buildActionRows(
  session: LunchSession,
): ActionRowBuilder<ButtonBuilder>[] {
  const locked = session.status === SessionStatus.Locked;
  if (locked) return buildLockedRows(session.id);

  return [
    buildAttendanceRow(session.id),
    buildRestaurantRow(session.id, !!session.lockedRestaurantId),
    buildCarpoolRow(session.id, false),
    buildMusterRow(session.id, false),
    buildAdminRow(session.id, false),
  ];
}

/** Vote select menu — shown in a follow-up ephemeral message. */
export function buildVoteSelectMenu(
  sessionId: string,
  restaurants: Restaurant[],
): ActionRowBuilder<StringSelectMenuBuilder> {
  const options = restaurants.map((r) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(r.name)
      .setValue(r.id)
      .setDescription(`${r.votes.length} vote${r.votes.length !== 1 ? 's' : ''}`),
  );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(SELECT.vote(sessionId))
      .setPlaceholder('Choose a restaurant to vote for')
      .addOptions(options),
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Convert "HH:MM" (24h) to "h:MM AM/PM" */
export function format12h(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}
