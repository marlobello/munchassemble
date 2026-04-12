import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
  Client,
} from 'discord.js';
import {
  startSession,
  getActiveSessionForGuild,
  attachMessageId,
  getCompletedSessionsForGuild,
} from '../services/sessionService.js';
import { getParticipantsForSession } from '../services/participantService.js';
import { getCarpoolsForSession } from '../services/carpoolService.js';
import { getRestaurantsForSession, getRestaurantById } from '../services/restaurantService.js';
import { buildPanel, format12h } from '../ui/panelBuilder.js';
import { scheduleReminders } from '../utils/scheduler.js';
import { AttendanceStatus, TransportStatus, SessionStatus } from '../types/index.js';

export const data = new SlashCommandBuilder()
  .setName('munchassemble')
  .setDescription('Munch Assemble — lunch coordination for the group 🍔')
  .addSubcommand((sub) =>
    sub
      .setName('create')
      .setDescription('Kick off a new lunch coordination session'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('status')
      .setDescription('Show the current status of the ongoing planning session'),
  )
  .addSubcommandGroup((group) =>
    group
      .setName('history')
      .setDescription('View past Munch Assemble sessions')
      .addSubcommand((sub) =>
        sub.setName('list').setDescription('Show the last 10 completed sessions for this server'),
      )
      .addSubcommand((sub) =>
        sub
          .setName('details')
          .setDescription('Show attendees and details for a session on a specific date')
          .addStringOption((opt) =>
            opt
              .setName('date')
              .setDescription('Date of the session (YYYY-MM-DD)')
              .setRequired(true),
          ),
      ),
  );

/** Route /munchassemble subcommands. */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand(false);
  const guildId = interaction.guildId!;

  if (group === 'history') {
    if (sub === 'list') await handleHistoryList(interaction, guildId);
    else if (sub === 'details') await handleHistoryDetails(interaction, guildId);
    return;
  }

  if (sub === 'create') {
    await handleCreate(interaction, guildId);
  } else if (sub === 'status') {
    await handleStatus(interaction, guildId);
  }
}

/** /munchassemble create — opens the session creation modal (BR-001). */
async function handleCreate(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  const existing = await getActiveSessionForGuild(guildId);
  if (existing) {
    await interaction.reply({
      content: `⚠️ There's already an active session for today (${existing.date}). Finalize it first with the **🔒 Finalize Plan** button on the session panel.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const today = new Date().toISOString().split('T')[0];

  const modal = new ModalBuilder()
    .setCustomId('modal:create_session')
    .setTitle('🍔 Create Lunch Session');

  const dateInput = new TextInputBuilder()
    .setCustomId('date')
    .setLabel('Date (YYYY-MM-DD)')
    .setStyle(TextInputStyle.Short)
    .setValue(today)
    .setRequired(true);

  const lunchTimeInput = new TextInputBuilder()
    .setCustomId('lunchTime')
    .setLabel('Lunch time (HH:MM, 24h)')
    .setStyle(TextInputStyle.Short)
    .setValue('11:15')
    .setRequired(true);

  const departTimeInput = new TextInputBuilder()
    .setCustomId('departTime')
    .setLabel('Departure time (HH:MM, 24h)')
    .setStyle(TextInputStyle.Short)
    .setValue('11:00')
    .setRequired(true);

  const notesInput = new TextInputBuilder()
    .setCustomId('notes')
    .setLabel('Notes (optional, e.g. "quick lunch")')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(dateInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(lunchTimeInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(departTimeInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput),
  );

  await interaction.showModal(modal);
}

/** /munchassemble status — shows live session snapshot for all users. */
async function handleStatus(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const session = await getActiveSessionForGuild(guildId);
  if (!session) {
    await interaction.editReply({ content: '📋 No active planning session right now.' });
    return;
  }

  const [participants, restaurants, carpools] = await Promise.all([
    getParticipantsForSession(session.id),
    getRestaurantsForSession(session.id),
    getCarpoolsForSession(session.id),
  ]);

  const statusLabel =
    session.status === SessionStatus.Locked ? '🔒 Locked' : '📝 Planning';

  const lines: string[] = [
    `## 🍔 Session Status — ${session.date}`,
    `**Status:** ${statusLabel}`,
    `**Lunch:** ${format12h(session.lunchTime)}  |  **Depart:** ${format12h(session.departTime)}`,
  ];

  if (session.notes) lines.push(`**Notes:** ${session.notes}`);

  // Attendance
  const inList = participants.filter((p) => p.attendanceStatus === AttendanceStatus.In);
  const maybeList = participants.filter((p) => p.attendanceStatus === AttendanceStatus.Maybe);
  const outList = participants.filter((p) => p.attendanceStatus === AttendanceStatus.Out);

  lines.push('');
  lines.push(`**👥 Attendance (${inList.length} in, ${maybeList.length} maybe, ${outList.length} out)**`);
  if (inList.length > 0) lines.push(`✅ In: ${inList.map((p) => p.displayName).join(', ')}`);
  if (maybeList.length > 0) lines.push(`❓ Maybe: ${maybeList.map((p) => p.displayName).join(', ')}`);
  if (outList.length > 0) lines.push(`❌ Out: ${outList.map((p) => p.displayName).join(', ')}`);

  // Restaurant votes
  lines.push('');
  if (restaurants.length === 0) {
    lines.push('**🍽️ Restaurant:** _No options suggested yet_');
  } else {
    const sorted = [...restaurants].sort((a, b) => b.votes.length - a.votes.length);
    if (session.lockedRestaurantId) {
      const locked = restaurants.find((r) => r.id === session.lockedRestaurantId);
      lines.push(`**🍽️ Restaurant:** 🔒 ${locked?.name ?? '_(unknown)_'}`);
    } else {
      lines.push('**🍽️ Restaurant options:**');
      for (const r of sorted) {
        lines.push(`  • ${r.name} — ${r.votes.length} vote${r.votes.length !== 1 ? 's' : ''}`);
      }
    }
  }

  // Carpool
  lines.push('');
  if (carpools.length === 0) {
    lines.push('**🚗 Carpools:** _No drivers registered yet_');
  } else {
    lines.push('**🚗 Carpools:**');
    for (const cp of carpools) {
      const driver = participants.find((p) => p.userId === cp.driverId);
      const driverName = driver?.displayName ?? `<@${cp.driverId}>`;
      const available = cp.seats - cp.riders.length;
      lines.push(
        `  • **${driverName}** @ ${cp.musterPoint} — ${cp.riders.length}/${cp.seats} riders (${available} seat${available !== 1 ? 's' : ''} free)`,
      );
    }
    const needRide = participants.filter(
      (p) => p.transportStatus === TransportStatus.NeedRide && !p.assignedDriverId,
    );
    if (needRide.length > 0) {
      lines.push(`  ⏳ Needs ride: ${needRide.map((p) => p.displayName).join(', ')}`);
    }
  }

  await interaction.editReply({ content: lines.join('\n') });
}

/** /munchassemble history list — last 10 completed sessions. */
async function handleHistoryList(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const sessions = await getCompletedSessionsForGuild(guildId, 10);
  if (sessions.length === 0) {
    await interaction.editReply({ content: '📋 No completed sessions found for this server.' });
    return;
  }

  const lines = await Promise.all(
    sessions.map(async (s, i) => {
      const participants = await getParticipantsForSession(s.id);
      const attendeeCount = participants.filter(
        (p) => p.attendanceStatus === AttendanceStatus.In,
      ).length;
      let restaurantName = '_(none chosen)_';
      if (s.lockedRestaurantId) {
        const r = await getRestaurantById(s.lockedRestaurantId, s.id);
        if (r) restaurantName = r.name;
      }
      return `${i + 1}. **${s.date}** ${format12h(s.lunchTime)} — 🍽️ ${restaurantName} — 👥 ${attendeeCount} attending`;
    }),
  );

  await interaction.editReply({
    content: `📋 **Recent Munch Sessions (last ${sessions.length}):**\n${lines.join('\n')}`,
  });
}

/** /munchassemble history details <date> — full detail for a single session. */
async function handleHistoryDetails(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const date = interaction.options.getString('date', true).trim();

  const sessions = await getCompletedSessionsForGuild(guildId, 100);
  const session = sessions.find((s) => s.date === date);

  if (!session) {
    await interaction.editReply({
      content: `📋 No completed session found for **${date}** on this server.`,
    });
    return;
  }

  const [participants, restaurant] = await Promise.all([
    getParticipantsForSession(session.id),
    session.lockedRestaurantId
      ? getRestaurantById(session.lockedRestaurantId, session.id)
      : Promise.resolve(null),
  ]);

  const attendees = participants.filter((p) => p.attendanceStatus === AttendanceStatus.In);
  const attendeeList =
    attendees.length > 0
      ? attendees.map((p) => `• ${p.displayName}`).join('\n')
      : '_No confirmed attendees_';

  const restaurantLine = restaurant
    ? `🍽️ **Restaurant:** ${restaurant.name}`
    : '🍽️ **Restaurant:** _(none chosen)_';

  await interaction.editReply({
    content: [
      `📋 **Session: ${date} at ${format12h(session.lunchTime)}**`,
      restaurantLine,
      `👥 **Attendees (${attendees.length}):**`,
      attendeeList,
    ].join('\n'),
  });
}

/** Handle the modal submission from /munchassemble. */
export async function handleCreateSessionModal(
  interaction: import('discord.js').ModalSubmitInteraction,
  client: Client,
): Promise<void> {
  const date = interaction.fields.getTextInputValue('date').trim();
  const lunchTime = interaction.fields.getTextInputValue('lunchTime').trim();
  const departTime = interaction.fields.getTextInputValue('departTime').trim();
  const notes = interaction.fields.getTextInputValue('notes').trim();

  // Validate date format and ensure it is not in the past
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    await interaction.reply({
      content: '❌ Invalid date format. Use YYYY-MM-DD (e.g. 2026-04-01).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const today = new Date().toISOString().split('T')[0];
  if (date < today) {
    await interaction.reply({
      content: `❌ You can't schedule a session in the past. Today is **${today}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Validate time formats — enforce valid hour (00-23) and minute (00-59)
  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!timeRegex.test(lunchTime) || !timeRegex.test(departTime)) {
    await interaction.reply({
      content: '❌ Invalid time format. Use HH:MM (e.g. 11:15).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (departTime >= lunchTime) {
    await interaction.reply({
      content: `❌ Departure time (**${departTime}**) must be before lunch time (**${lunchTime}**).`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Defer immediately — we need to post the panel
  await interaction.deferReply();

  try {
    const session = await startSession({
      guildId: interaction.guildId!,
      channelId: interaction.channelId ?? '',
      creatorId: interaction.user.id,
      date,
      lunchTime,
      departTime,
      notes: notes || undefined,
    });

    const participants = await getParticipantsForSession(session.id);
    const carpools = await getCarpoolsForSession(session.id);
    const panel = buildPanel(session, participants, [], carpools);

    const message = await interaction.editReply(panel as any);

    // Store the message ID so handlers can edit the panel later
    const attached = await attachMessageId(session, message.id);

    // Schedule T-15 and T-5 reminders (Phase 3)
    scheduleReminders(attached, client);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await interaction.editReply({ content: `❌ ${msg}` });
  }
}
