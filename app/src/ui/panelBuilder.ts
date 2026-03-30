import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
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

// ─── Panel content (replaces embed) ──────────────────────────────────────────

/** Builds the markdown text displayed in the panel info section. */
function buildPanelContent(
  session: LunchSession,
  participants: Participant[],
  restaurants: Restaurant[],
  carpools: Carpool[],
): string {
  const isLocked = session.status === SessionStatus.Locked;
  const title = isLocked ? '🔒 **FINALIZED – MUNCH ASSEMBLE**' : '🍔 **MUNCH ASSEMBLE**';

  // Restaurant leaderboard
  const sorted = [...restaurants].sort((a, b) => b.votes.length - a.votes.length);
  const restaurantLines = sorted.length
    ? sorted
        .map((r, i) => {
          const isLocked = session.lockedRestaurantId === r.id;
          const prefix = isLocked ? '🔒' : `${i + 1}.`;
          return `${prefix} **${r.name}** — ${r.votes.length} vote${r.votes.length !== 1 ? 's' : ''}`;
        })
        .join('\n')
    : '*No options added yet*';

  // Attendance groups
  const inList = participants.filter((p) => p.attendanceStatus === AttendanceStatus.In);
  const maybeList = participants.filter((p) => p.attendanceStatus === AttendanceStatus.Maybe);
  const outList = participants.filter((p) => p.attendanceStatus === AttendanceStatus.Out);
  const soloList = participants.filter((p) => p.attendanceStatus === AttendanceStatus.DrivingAlone);

  const nameStr = (ps: Participant[]) => ps.length ? ps.map((p) => p.displayName).join(', ') : '*None yet*';

  const attendanceLine = [
    `✅ **In (${inList.length}):** ${nameStr(inList)}`,
    `🤔 **Maybe (${maybeList.length}):** ${nameStr(maybeList)}`,
    `❌ **Out:** ${outList.length || '*None*'}`,
    soloList.length ? `🚘 **Driving Alone:** ${soloList.map((p) => p.displayName).join(', ')}` : null,
  ].filter(Boolean).join('\n');

  const lines: string[] = [
    `${title} – ${formatDate(session.date)}`,
    '',
    `### 📍 Restaurant Voting`,
    restaurantLines,
    '',
    `### 👥 Attendance`,
    attendanceLine,
    '',
    `⏰ **Lunch:** ${format12h(session.lunchTime)}  |  **Depart:** ${format12h(session.departTime)}`,
  ];

  if (session.notes) {
    lines.push(`📝 **Notes:** ${session.notes}`);
  }

  if (carpools.length > 0) {
    lines.push('', '### 🚗 Carpools');
    for (const c of carpools) {
      const driverName = participants.find((p) => p.userId === c.driverId)?.displayName ?? `<@${c.driverId}>`;
      const riderNames = c.riders.map((rid) => participants.find((p) => p.userId === rid)?.displayName ?? `<@${rid}>`).join(', ');
      lines.push(`🚗 **${driverName}** (${c.riders.length}/${c.seats} seats) @ ${c.musterPoint}${c.riders.length > 0 ? ` — ${riderNames}` : ''}`);
    }
  }

  // Muster points — exclude solo drivers
  const withMuster = participants.filter(
    (p) => p.musterPoint && p.attendanceStatus !== AttendanceStatus.DrivingAlone,
  );
  if (withMuster.length > 0) {
    const grouped = withMuster.reduce<Record<string, string[]>>((acc, p) => {
      (acc[p.musterPoint!] ??= []).push(p.displayName);
      return acc;
    }, {});
    lines.push('', '### 📍 Muster Points');
    for (const [point, names] of Object.entries(grouped)) {
      lines.push(`📍 **${point}:** ${names.join(', ')}`);
    }
  }

  lines.push('', isLocked ? '🟢 *Status: Finalized*' : '🟡 *Status: Planning*');

  return lines.join('\n');
}

// ─── Action rows ──────────────────────────────────────────────────────────────

/** Row 1 — Attendance */
function buildAttendanceRow(sessionId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(BTN.in(sessionId)).setLabel("✅ I'm In").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(BTN.maybe(sessionId)).setLabel('🤔 Maybe').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(BTN.out(sessionId)).setLabel('❌ Out').setStyle(ButtonStyle.Danger),
  );
}

/** Row 2 — Restaurant */
function buildRestaurantRow(sessionId: string, locked: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(BTN.vote(sessionId)).setLabel('🍔 Vote').setStyle(ButtonStyle.Primary).setDisabled(locked),
    new ButtonBuilder().setCustomId(BTN.addSpot(sessionId)).setLabel('➕ Add Spot').setStyle(ButtonStyle.Secondary).setDisabled(locked),
    new ButtonBuilder().setCustomId(BTN.lockChoice(sessionId)).setLabel('🔒 Lock Choice').setStyle(ButtonStyle.Danger).setDisabled(locked),
  );
}

/** Row 3 — Transportation */
function buildTransportRow(sessionId: string, locked: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(BTN.driving(sessionId)).setLabel("🚗 I'm Driving").setStyle(ButtonStyle.Success).setDisabled(locked),
    new ButtonBuilder().setCustomId(BTN.drivingAlone(sessionId)).setLabel('🚘 Driving Alone').setStyle(ButtonStyle.Secondary).setDisabled(locked),
    new ButtonBuilder().setCustomId(BTN.needRide(sessionId)).setLabel('🚌 Need Ride').setStyle(ButtonStyle.Primary).setDisabled(locked),
  );
}

/** Row 4 — Location */
function buildLocationRow(sessionId: string, locked: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(BTN.muster(sessionId)).setLabel('📍 Set Muster Point').setStyle(ButtonStyle.Secondary).setDisabled(locked),
  );
}

/** Row 5 — Admin */
function buildAdminRow(sessionId: string, locked: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(BTN.autoAssign(sessionId)).setLabel('🤖 Auto Assign').setStyle(ButtonStyle.Secondary).setDisabled(locked),
    new ButtonBuilder().setCustomId(BTN.finalize(sessionId)).setLabel('🔒 Finalize Plan').setStyle(ButtonStyle.Danger).setDisabled(locked),
    new ButtonBuilder().setCustomId(BTN.ping(sessionId)).setLabel('🔔 Ping Unanswered').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(BTN.editTime(sessionId)).setLabel('✏️ Edit Time').setStyle(ButtonStyle.Secondary).setDisabled(locked),
  );
}

// ─── Panel builder (Components v2) ───────────────────────────────────────────

/** The payload shape to spread into any discord.js send/update/editReply call. */
export interface PanelPayload {
  flags: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components: any[];
}

/**
 * Builds the full Components v2 panel message payload.
 * Returns { flags, components } — spread this directly into reply/update/editReply.
 */
export function buildPanel(
  session: LunchSession,
  participants: Participant[],
  restaurants: Restaurant[],
  carpools: Carpool[] = [],
): PanelPayload {
  const isLocked = session.status === SessionStatus.Locked;
  const accentColor = isLocked ? 0x57f287 : 0xfee75c;
  const content = buildPanelContent(session, participants, restaurants, carpools);

  if (isLocked) {
    // Finalized — info only, no interactive buttons
    const container = new ContainerBuilder()
      .setAccentColor(accentColor)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  }

  const restaurantLocked = !!session.lockedRestaurantId;
  const sep = () => new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small);

  const container = new ContainerBuilder()
    .setAccentColor(accentColor)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    // ── Attendance ──
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('**── Attendance ──**'))
    .addActionRowComponents(buildAttendanceRow(session.id))
    .addSeparatorComponents(sep())
    // ── Restaurant ──
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('**── Restaurant ──**'))
    .addActionRowComponents(buildRestaurantRow(session.id, restaurantLocked))
    .addSeparatorComponents(sep())
    // ── Transportation ──
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('**── Transportation ──**'))
    .addActionRowComponents(buildTransportRow(session.id, false))
    .addSeparatorComponents(sep())
    // ── Location ──
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('**── Location ──**'))
    .addActionRowComponents(buildLocationRow(session.id, false))
    .addSeparatorComponents(sep())
    // ── Admin ──
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('**── Admin ──**'))
    .addActionRowComponents(buildAdminRow(session.id, false));

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
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
