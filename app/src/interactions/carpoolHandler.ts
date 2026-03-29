import {
  ActionRowBuilder,
  ButtonInteraction,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { getActiveSessionForGuild } from '../services/sessionService.js';
import {
  registerDriver,
  clearCarpoolRole,
  requestRide,
  autoAssignRides,
  getCarpoolsForSession,
} from '../services/carpoolService.js';
import { getParticipantsForSession } from '../services/participantService.js';
import { getRestaurantsForSession } from '../services/restaurantService.js';
import { getMusterPoints } from '../services/musterService.js';
import { buildSessionEmbed, buildActionRows, SELECT } from '../ui/panelBuilder.js';
import type { Client } from 'discord.js';

export const CARPOOL_SELECT = {
  needRide: (sid: string) => `carpool:need_ride:${sid}`,
  musterDrive: (sid: string) => `carpool:muster_drive:${sid}`,
};

/** [🚗 I'm Driving] button — opens modal for seats + muster point. */
export async function handleDrivingButton(interaction: ButtonInteraction): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');

  const modal = new ModalBuilder()
    .setCustomId(`modal:driving:${sessionId}`)
    .setTitle('🚗 Register as Driver');

  const seatsInput = new TextInputBuilder()
    .setCustomId('seats')
    .setLabel('Seats available (excluding yourself)')
    .setStyle(TextInputStyle.Short)
    .setValue('3')
    .setRequired(true);

  const musterInput = new TextInputBuilder()
    .setCustomId('musterPoint')
    .setLabel('Your muster/pickup point')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g. Garage A')
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(seatsInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(musterInput),
  );

  await interaction.showModal(modal);
}

/** Handle [🚗 I'm Driving] modal submission. */
export async function handleDrivingModal(
  interaction: ModalSubmitInteraction,
  client: Client,
): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.reply({ content: '⚠️ Session not active.', flags: MessageFlags.Ephemeral });
    return;
  }

  const seatsRaw = interaction.fields.getTextInputValue('seats').trim();
  const musterPoint = interaction.fields.getTextInputValue('musterPoint').trim();
  const seats = parseInt(seatsRaw, 10);

  if (isNaN(seats) || seats < 1 || seats > 10) {
    await interaction.reply({
      content: '❌ Seats must be a number between 1 and 10.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    await registerDriver(session.id, interaction.user.id, seats, musterPoint);
    await refreshPanel(interaction, session, client);
    await interaction.editReply({
      content: `✅ You're registered as a driver with **${seats}** seat(s) from **${musterPoint}**.`,
    });
  } catch (err) {
    await interaction.editReply({
      content: `❌ ${err instanceof Error ? err.message : 'Failed to register as driver.'}`,
    });
  }
}

/** [🚌 Need Ride] button — shows muster point select for rider. */
export async function handleNeedRideButton(
  interaction: ButtonInteraction,
  client: Client,
): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.reply({ content: '⚠️ Session not active.', flags: MessageFlags.Ephemeral });
    return;
  }

  const musterPoints = await getMusterPoints(session.guildId);
  if (musterPoints.length === 0) {
    // No muster points — just register as rider without one
    await requestRide(
      session.id,
      interaction.user.id,
      interaction.user.username,
      interaction.member
        ? (interaction.member as import('discord.js').GuildMember).displayName
        : interaction.user.displayName,
    );
    await refreshPanel(interaction, session, client);
    await interaction.reply({
      content: `✅ You've been added as needing a ride.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const options = musterPoints.map((mp) =>
    new StringSelectMenuOptionBuilder().setLabel(mp.name).setValue(mp.name),
  );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(CARPOOL_SELECT.needRide(sessionId))
      .setPlaceholder('Select your muster/pickup point')
      .addOptions(options),
  );

  await interaction.reply({
    content: '📍 Where should your driver pick you up?',
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

/** Handle muster point selection for a rider. */
export async function handleNeedRideSelect(
  interaction: StringSelectMenuInteraction,
  client: Client,
): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.update({ content: '⚠️ Session expired.', components: [] });
    return;
  }

  const musterPoint = interaction.values[0];
  const member = interaction.member as import('discord.js').GuildMember;

  await requestRide(
    session.id,
    interaction.user.id,
    interaction.user.username,
    member?.displayName ?? interaction.user.displayName,
  );

  // Also store muster point on the participant record
  const { upsertParticipant } = await import('../db/repositories/participantRepo.js');
  const { getParticipant } = await import('../db/repositories/participantRepo.js');
  const p = await getParticipant(session.id, interaction.user.id);
  if (p) {
    await upsertParticipant({ ...p, musterPoint, updatedAt: new Date().toISOString() });
  }

  await refreshPanel(interaction, session, client);
  await interaction.update({
    content: `✅ You need a ride from **${musterPoint}**. We'll find you a driver!`,
    components: [],
  });
}

/** [🔄 Switch] button — clears the user's carpool role. */
export async function handleCarpoolSwitchButton(
  interaction: ButtonInteraction,
  client: Client,
): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.reply({ content: '⚠️ Session not active.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await clearCarpoolRole(session.id, interaction.user.id);
  await refreshPanel(interaction, session, client);
  await interaction.editReply({ content: '✅ Your carpool role has been cleared.' });
}

/** [🤖 Auto Assign] button — assigns all unmatched riders to drivers. Creator/admin only. */
export async function handleAutoAssignButton(
  interaction: ButtonInteraction,
  client: Client,
): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.reply({ content: '⚠️ Session not active.', flags: MessageFlags.Ephemeral });
    return;
  }

  const { isCreatorOrAdmin, getMember } = await import('../utils/permissions.js');
  if (!isCreatorOrAdmin(interaction.user.id, getMember(interaction), session)) {
    await interaction.reply({
      content: '🚫 Only the session creator or an admin can auto-assign rides.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const updated = await autoAssignRides(session.id);
  await refreshPanel(interaction, session, client);

  const totalAssigned = updated.reduce((sum, c) => sum + c.riders.length, 0);
  await interaction.editReply({
    content: `✅ Auto-assign complete! **${totalAssigned}** rider${totalAssigned !== 1 ? 's' : ''} matched across **${updated.length}** driver${updated.length !== 1 ? 's' : ''}.`,
  });
}

/** Refresh the session panel after a carpool change. */
async function refreshPanel(
  interaction:
    | ButtonInteraction
    | StringSelectMenuInteraction
    | ModalSubmitInteraction,
  session: import('../types/index.js').LunchSession,
  client: Client,
): Promise<void> {
  const [participants, restaurants, carpools] = await Promise.all([
    getParticipantsForSession(session.id),
    getRestaurantsForSession(session.id),
    getCarpoolsForSession(session.id),
  ]);

  const embed = buildSessionEmbed(session, participants, restaurants, carpools);
  const rows = buildActionRows(session);

  // Edit the original panel message
  if (session.messageId && interaction.channel) {
    try {
      const msg = await interaction.channel.messages.fetch(session.messageId);
      await msg.edit({ embeds: [embed], components: rows });
    } catch {
      // Panel message may have been deleted — not critical
    }
  }
}

export { getCarpoolsForSession };
