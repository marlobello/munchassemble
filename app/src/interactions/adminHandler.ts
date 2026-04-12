import type { ButtonInteraction, GuildMember, ModalSubmitInteraction } from 'discord.js';
import { MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { getActiveSessionForGuild, finalizeSession, updateSessionTimes } from '../services/sessionService.js';
import { getParticipantsForSession, getUnansweredUserIds } from '../services/participantService.js';
import { getRestaurantsForSession } from '../services/restaurantService.js';
import { getCarpoolsForSession } from '../services/carpoolService.js';
import { buildPanel } from '../ui/panelBuilder.js';
import { isCreatorOrAdmin, getMember } from '../utils/permissions.js';
import { refreshPanelMessage } from '../utils/panelRefresh.js';
import { AttendanceStatus, TransportStatus } from '../types/index.js';
import { getNoPingListForGuild } from '../db/repositories/noPingRepo.js';

/** [🔒 Finalize Plan] button — locks the session (BR-004). Creator/admin only. */
export async function handleFinalizeButton(interaction: ButtonInteraction): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.reply({ content: '⚠️ Session not active.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (!isCreatorOrAdmin(interaction.user.id, getMember(interaction), session)) {
    await interaction.reply({
      content: '🚫 Only the session creator or a server admin can finalize the plan.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const updatedSession = await finalizeSession(session);
  const [participants, restaurants, carpools] = await Promise.all([
    getParticipantsForSession(session.id),
    getRestaurantsForSession(session.id),
    getCarpoolsForSession(session.id),
  ]);

  const panel = buildPanel(updatedSession, participants, restaurants, carpools);
  await interaction.update(panel as any);

  // Post a summary message to the channel
  const inList = participants.filter((p) => p.attendanceStatus === AttendanceStatus.In);
  const restaurant = restaurants.find((r) => r.id === updatedSession.lockedRestaurantId);

  const lines: string[] = [
    `🔒 **Plan finalized!**`,
    `⏰ **Depart:** ${updatedSession.departTime} | **Lunch:** ${updatedSession.lunchTime}`,
    `👥 **Going (${inList.length}):** ${inList.map((p) => p.displayName).join(', ') || 'TBD'}`,
    `🍔 **Restaurant:** ${restaurant?.name ?? 'TBD'}`,
  ];

  // Transportation details
  const soloDrivers = participants.filter((p) => p.transportStatus === TransportStatus.DrivingAlone);
  const unassignedRiders = participants.filter(
    (p) => p.transportStatus === TransportStatus.NeedRide && !p.assignedDriverId,
  );

  if (carpools.length > 0 || soloDrivers.length > 0 || unassignedRiders.length > 0) {
    lines.push('', '🚗 **Transportation**');

    for (const carpool of carpools) {
      const driverName =
        participants.find((p) => p.userId === carpool.driverId)?.displayName ?? `<@${carpool.driverId}>`;
      const riderNames = carpool.riders
        .map((rid) => participants.find((p) => p.userId === rid)?.displayName ?? `<@${rid}>`)
        .join(', ');
      const seatsFree = carpool.seats - carpool.riders.length;
      const seatsLabel = seatsFree > 0 ? `${seatsFree} seat${seatsFree !== 1 ? 's' : ''} open` : 'full';
      const riderPart = carpool.riders.length > 0 ? ` → ${riderNames}` : ' → no riders yet';
      lines.push(`  🚗 **${driverName}** (${carpool.musterPoint}, ${seatsLabel})${riderPart}`);
    }

    if (soloDrivers.length > 0) {
      lines.push(`  🚘 **Driving alone:** ${soloDrivers.map((p) => p.displayName).join(', ')}`);
    }

    if (unassignedRiders.length > 0) {
      lines.push(`  🚌 **Still need a ride:** ${unassignedRiders.map((p) => p.displayName).join(', ')}`);
    }
  }

  await interaction.followUp({ content: lines.join('\n') });
}

/** [🔔 Ping Unanswered] button — mentions users who haven't RSVPed (BR-012). Creator/admin only. */
export async function handlePingButton(interaction: ButtonInteraction): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.reply({ content: '⚠️ Session not active.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (!isCreatorOrAdmin(interaction.user.id, getMember(interaction), session)) {
    await interaction.reply({
      content: '🚫 Only the session creator or a server admin can ping unanswered members.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Fetch all non-bot guild members
  const guild = interaction.guild;
  if (!guild) return;
  await guild.members.fetch();
  const memberIds = guild.members.cache
    .filter((m) => !m.user.bot)
    .map((m) => m.id);

  // Exclude users on the no-ping list (Issue #5)
  const noPingEntries = await getNoPingListForGuild(interaction.guildId!);
  const noPingIds = new Set(noPingEntries.map((e) => e.userId));
  const pingableIds = memberIds.filter((id) => !noPingIds.has(id));

  const unanswered = await getUnansweredUserIds(session.id, pingableIds);

  if (unanswered.length === 0) {
    await interaction.reply({
      content: '✅ Everyone has responded!',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const mentions = unanswered.map((id) => `<@${id}>`).join(' ');
  await interaction.reply({
    content: `👀 **Still need responses from:** ${mentions}`,
    allowedMentions: { users: unanswered },
  });
}

/** [✏️ Edit Time] button — opens the time-edit modal directly. Creator/admin only. */
export async function handleEditTimeButton(interaction: ButtonInteraction): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.reply({ content: '⚠️ Session not active.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (!isCreatorOrAdmin(interaction.user.id, getMember(interaction), session)) {
    await interaction.reply({
      content: '🚫 Only the session creator or a server admin can edit the time.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`modal:edit_time:${sessionId}`)
    .setTitle('✏️ Edit Session Times');

  const lunchInput = new TextInputBuilder()
    .setCustomId('lunchTime')
    .setLabel('Lunch time (HH:MM, 24h)')
    .setStyle(TextInputStyle.Short)
    .setValue(session.lunchTime)
    .setRequired(true);

  const departInput = new TextInputBuilder()
    .setCustomId('departTime')
    .setLabel('Departure time (HH:MM, 24h)')
    .setStyle(TextInputStyle.Short)
    .setValue(session.departTime)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(lunchInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(departInput),
  );

  await interaction.showModal(modal);
}

/** Handle the Edit Time modal submission. */
export async function handleEditTimeModal(
  interaction: ModalSubmitInteraction,
  client: import('discord.js').Client,
): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.reply({ content: '⚠️ Session not active.', flags: MessageFlags.Ephemeral });
    return;
  }

  const lunchTime = interaction.fields.getTextInputValue('lunchTime').trim();
  const departTime = interaction.fields.getTextInputValue('departTime').trim();

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

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const updated = await updateSessionTimes(session, lunchTime, departTime);

    const { scheduleReminders } = await import('../utils/scheduler.js');
    scheduleReminders(updated, client);

    await refreshPanelMessage(updated, client);

    await interaction.editReply({
      content: `✅ Times updated — Lunch: **${lunchTime}**, Depart: **${departTime}**.`,
    });
  } catch (err) {
    await interaction.editReply({
      content: `❌ ${err instanceof Error ? err.message : 'Failed to update times.'}`,
    });
  }
}
