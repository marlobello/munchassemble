import type { ButtonInteraction, GuildMember, ModalSubmitInteraction } from 'discord.js';
import { MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, Routes } from 'discord.js';
import { getActiveSessionForGuild, finalizeSession, updateSessionTimes } from '../services/sessionService.js';
import { getParticipantsForSession, getUnansweredUserIds } from '../services/participantService.js';
import { getRestaurantsForSession } from '../services/restaurantService.js';
import { getCarpoolsForSession } from '../services/carpoolService.js';
import { buildPanel } from '../ui/panelBuilder.js';
import { isCreatorOrAdmin, getMember } from '../utils/permissions.js';

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
  const inList = participants.filter((p) => p.attendanceStatus === 'in');
  const restaurant = restaurants.find((r) => r.id === updatedSession.lockedRestaurantId);
  const summary =
    `🔒 **Plan finalized!**\n` +
    `🍔 **Restaurant:** ${restaurant?.name ?? 'TBD'}\n` +
    `👥 **Going (${inList.length}):** ${inList.map((p) => p.displayName).join(', ') || 'TBD'}\n` +
    `⏰ **Lunch:** ${updatedSession.lunchTime} | **Depart:** ${updatedSession.departTime}`;

  await interaction.followUp({ content: summary });
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

  const unanswered = await getUnansweredUserIds(session.id, memberIds);

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

/** [✏️ Edit Time] button — opens modal to update lunch/depart times. Creator/admin only. */
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

  const timeRegex = /^\d{1,2}:\d{2}$/;
  if (!timeRegex.test(lunchTime) || !timeRegex.test(departTime)) {
    await interaction.reply({
      content: '❌ Invalid time format. Use HH:MM (e.g. 11:15).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const updated = await updateSessionTimes(session, lunchTime, departTime);

    // Reschedule reminders with the new time
    const { scheduleReminders } = await import('../utils/scheduler.js');
    scheduleReminders(updated, client);

    const [participants, restaurants, carpools] = await Promise.all([
      getParticipantsForSession(session.id),
      getRestaurantsForSession(session.id),
      getCarpoolsForSession(session.id),
    ]);

    const panel = buildPanel(updated, participants, restaurants, carpools);

    if (session.messageId) {
      try {
        await interaction.client.rest.patch(
          Routes.channelMessage(session.channelId, session.messageId),
          { body: { flags: panel.flags, components: panel.components.map((c) => c.toJSON()) } },
        );
      } catch (err) {
        console.error('[panel] Failed to refresh panel after time edit:', err);
      }
    }

    await interaction.editReply({
      content: `✅ Times updated — Lunch: **${lunchTime}**, Depart: **${departTime}**.`,
    });
  } catch (err) {
    await interaction.editReply({
      content: `❌ ${err instanceof Error ? err.message : 'Failed to update times.'}`,
    });
  }
}
