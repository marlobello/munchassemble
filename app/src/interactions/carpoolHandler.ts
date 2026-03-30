import {
  ActionRowBuilder,
  ButtonInteraction,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
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
  assignRiderToDriver,
} from '../services/carpoolService.js';
import { getParticipantsForSession, setTransport } from '../services/participantService.js';
import { getRestaurantsForSession } from '../services/restaurantService.js';
import { buildPanel } from '../ui/panelBuilder.js';
import { TransportStatus } from '../types/index.js';
import { refreshPanelMessage } from '../utils/panelRefresh.js';
import { transportBlockedReason, canHostCarpool } from '../utils/stateRules.js';
import { getParticipant } from '../db/repositories/participantRepo.js';
import { isCreatorOrAdmin, getMember } from '../utils/permissions.js';
import type { Client } from 'discord.js';

/**
 * [🚘 Driving Alone] button — toggles DrivingAlone transport status.
 * customId: carpool:driving_alone:<sessionId>
 */
export async function handleDrivingAloneButton(
  interaction: ButtonInteraction,
  client: Client,
): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.reply({ content: '⚠️ Session not active.', flags: MessageFlags.Ephemeral });
    return;
  }

  const member = interaction.member as import('discord.js').GuildMember;

  // Fetch current state to determine toggle direction and validate
  const participant = await getParticipant(session.id, interaction.user.id);
  const isCurrentlyDrivingAlone = participant?.transportStatus === TransportStatus.DrivingAlone;
  const newTransport = isCurrentlyDrivingAlone ? TransportStatus.None : TransportStatus.DrivingAlone;

  // State machine: Out cannot set any transport (toggle OFF is always allowed)
  if (newTransport !== TransportStatus.None) {
    const blocked = transportBlockedReason(participant, newTransport);
    if (blocked) {
      await interaction.reply({ content: blocked, flags: MessageFlags.Ephemeral });
      return;
    }
  }

  // Acknowledge immediately to stay within the 3s Discord window
  await interaction.deferUpdate();

  if (!isCurrentlyDrivingAlone) {
    // Clear any active CanDrive carpool or NeedRide assignment before switching to Driving Alone
    await clearCarpoolRole(session.id, interaction.user.id);
  }

  await setTransport(
    session.id,
    interaction.user.id,
    interaction.user.username,
    member?.displayName ?? interaction.user.displayName,
    newTransport,
  );

  // Fetch fresh data and update the panel
  const [updatedParticipants, restaurants, carpools] = await Promise.all([
    getParticipantsForSession(session.id),
    getRestaurantsForSession(session.id),
    getCarpoolsForSession(session.id),
  ]);
  const panel = buildPanel(session, updatedParticipants, restaurants, carpools);
  await interaction.editReply(panel as any);
}


export async function handleDrivingButton(interaction: ButtonInteraction): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');

  // State machine: only In (or unset) can host a carpool; block Out and Maybe
  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (session && session.id === sessionId) {
    const participant = await getParticipant(session.id, interaction.user.id);
    if (!canHostCarpool(participant)) {
      const blocked = transportBlockedReason(participant, TransportStatus.CanDrive);
      await interaction.reply({ content: blocked ?? "❌ You cannot host a carpool right now.", flags: MessageFlags.Ephemeral });
      return;
    }
  }

  const modal = new ModalBuilder()
    .setCustomId(`modal:driving:${sessionId}`)
    .setTitle('🚗 Can Drive');

  const seatsInput = new TextInputBuilder()
    .setCustomId('seats')
    .setLabel('Seats available (excluding yourself)')
    .setStyle(TextInputStyle.Short)
    .setValue('3')
    .setRequired(true);

  const musterInput = new TextInputBuilder()
    .setCustomId('musterPoint')
    .setLabel('Your pickup location (muster point)')
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
    await refreshPanelMessage(session, client);
    await interaction.editReply({
      content: `✅ You're registered as a driver with **${seats}** seat(s) from **${musterPoint}**.`,
    });
  } catch (err) {
    await interaction.editReply({
      content: `❌ ${err instanceof Error ? err.message : 'Failed to register as driver.'}`,
    });
  }
}

/** [🚌 Need Ride] button — toggles NeedRide status directly on the panel (no ephemeral). */
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

  const participant = await getParticipant(session.id, interaction.user.id);

  // State machine: Out cannot request a ride; toggle OFF is always allowed
  const isCurrentlyNeedRide = participant?.transportStatus === TransportStatus.NeedRide;
  if (!isCurrentlyNeedRide) {
    const blocked = transportBlockedReason(participant, TransportStatus.NeedRide);
    if (blocked) {
      await interaction.reply({ content: blocked, flags: MessageFlags.Ephemeral });
      return;
    }
  }

  // Acknowledge immediately before DB work
  await interaction.deferUpdate();

  const member = interaction.member as import('discord.js').GuildMember;

  if (isCurrentlyNeedRide) {
    // Toggle off — clear the ride request
    await clearCarpoolRole(session.id, interaction.user.id);
  } else {
    // Toggle on — register as needing a ride
    await requestRide(
      session.id,
      interaction.user.id,
      interaction.user.username,
      member?.displayName ?? interaction.user.displayName,
    );
  }

  const [updatedParticipants, restaurants, carpools] = await Promise.all([
    getParticipantsForSession(session.id),
    getRestaurantsForSession(session.id),
    getCarpoolsForSession(session.id),
  ]);
  const panel = buildPanel(session, updatedParticipants, restaurants, carpools);
  await interaction.editReply(panel as any);
}

/**
 * [🚗 Join Driver] inline button — assigns the user to a specific carpool driver (no ephemeral).
 * customId: carpool:join:<sessionId>:<driverId>
 */
export async function handleJoinCarpoolButton(
  interaction: ButtonInteraction,
  client: Client,
): Promise<void> {
  const parts = interaction.customId.split(':');
  const sessionId = parts[2];
  const driverId = parts[3];

  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.reply({ content: '⚠️ Session not active.', flags: MessageFlags.Ephemeral });
    return;
  }

  // State machine check before deferring (fast read)
  const participant = await getParticipant(session.id, interaction.user.id);
  const blocked = transportBlockedReason(participant, TransportStatus.NeedRide);
  if (blocked) {
    await interaction.reply({ content: blocked, flags: MessageFlags.Ephemeral });
    return;
  }

  // Acknowledge immediately before DB work
  await interaction.deferUpdate();

  const member = interaction.member as import('discord.js').GuildMember;

  try {
    await assignRiderToDriver(
      session.id,
      interaction.user.id,
      driverId,
      interaction.user.username,
      member?.displayName ?? interaction.user.displayName,
    );
  } catch (err) {
    // Can't editReply with an error on a deferUpdate — show as follow-up
    await interaction.followUp({
      content: `❌ ${err instanceof Error ? err.message : 'Could not join carpool.'}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const [updatedParticipants, restaurants, carpools] = await Promise.all([
    getParticipantsForSession(session.id),
    getRestaurantsForSession(session.id),
    getCarpoolsForSession(session.id),
  ]);
  const panel = buildPanel(session, updatedParticipants, restaurants, carpools);
  await interaction.editReply(panel as any);
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
  await refreshPanelMessage(session, client);
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

  if (!isCreatorOrAdmin(interaction.user.id, getMember(interaction), session)) {
    await interaction.reply({
      content: '🚫 Only the session creator or an admin can auto-assign rides.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const updated = await autoAssignRides(session.id);
  await refreshPanelMessage(session, client);

  const totalAssigned = updated.reduce((sum, c) => sum + c.riders.length, 0);
  await interaction.editReply({
    content: `✅ Auto-assign complete! **${totalAssigned}** rider${totalAssigned !== 1 ? 's' : ''} matched across **${updated.length}** driver${updated.length !== 1 ? 's' : ''}.`,
  });
}

export { getCarpoolsForSession };
