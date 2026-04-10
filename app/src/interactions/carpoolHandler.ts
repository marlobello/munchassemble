import {
  ActionRowBuilder,
  ButtonInteraction,
  GuildMember,
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
import { getMusterPoints } from '../services/musterService.js';
import {
  storePendingInteraction,
  setPendingMusterPoint,
  takePendingInteraction,
} from '../utils/pendingInteractions.js';
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


/**
 * [🚗 Can Drive] button — shows an ephemeral muster point select menu (BR-030).
 * customId: carpool:driving:<sessionId>
 *
 * Flow:
 *   1. deferUpdate() to keep the panel token alive and store the interaction.
 *   2. followUp with an ephemeral select menu listing configured muster points + "Other…".
 *   3. User picks a muster point → handleDrivingMusterSelect().
 *   4. Modal submit → handleDrivingModal() → panel updated via stored interaction.
 */
export async function handleDrivingButton(
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
  if (!canHostCarpool(participant)) {
    const blocked = transportBlockedReason(participant, TransportStatus.CanDrive);
    await interaction.reply({
      content: blocked ?? '❌ You cannot host a carpool right now.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const musterPoints = await getMusterPoints(interaction.guildId!);

  // Acknowledge the panel button and store the interaction for later panel update.
  await interaction.deferUpdate();
  storePendingInteraction(`driving:${sessionId}`, interaction);

  const options = musterPoints.map((mp) =>
    new StringSelectMenuOptionBuilder().setLabel(mp.name).setValue(`mp::${mp.name}`),
  );

  if (options.length === 0) {
    // No muster points configured — prompt admin to set them up
    await interaction.followUp({
      content: '⚠️ No pickup locations are configured. Ask an admin to run `/munchassemble-config` to add muster points.',
      flags: MessageFlags.Ephemeral,
    });
    takePendingInteraction(`driving:${sessionId}`);
    return;
  }

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`carpool:driving_muster:${sessionId}`)
      .setPlaceholder('Pick your pickup location (muster point)')
      .addOptions(options),
  );

  await interaction.followUp({
    content: '🚗 Where will you pick up riders?',
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * Select menu for muster point choice in the Can Drive flow.
 * customId: carpool:driving_muster:<sessionId>
 *
 * - Known muster point: stores it in the pending entry, then shows a seats-only modal.
 * - "Other…": shows a full modal (muster + seats) without touching the pending store.
 */
export async function handleDrivingMusterSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const musterName = interaction.values[0].replace(/^mp::/, '');

  // Attach the muster point to the pending entry, then show a seats-only modal.
  setPendingMusterPoint(`driving:${sessionId}`, musterName);

  const modal = new ModalBuilder()
    .setCustomId(`modal:driving_seats:${sessionId}`)
    .setTitle(`🚗 Can Drive — ${musterName}`);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('seats')
        .setLabel('Seats available (excluding yourself)')
        .setStyle(TextInputStyle.Short)
        .setValue('3')
        .setRequired(true),
    ),
  );

  await interaction.showModal(modal);
}

/** Handle Can Drive modal submission (seats-only or full). */
export async function handleDrivingModal(
  interaction: ModalSubmitInteraction,
  client: Client,
): Promise<void> {
  const parts = interaction.customId.split(':');
  const type = parts[1]; // 'driving_full' | 'driving_seats'
  const sessionId = parts[2];

  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.reply({ content: '⚠️ Session not active.', flags: MessageFlags.Ephemeral });
    return;
  }

  const seatsRaw = interaction.fields.getTextInputValue('seats').trim();
  const seats = parseInt(seatsRaw, 10);
  if (isNaN(seats) || seats < 1 || seats > 10) {
    await interaction.reply({
      content: '❌ Seats must be a number between 1 and 10.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Retrieve (and remove) the stored panel interaction plus any attached muster point.
  const pending = takePendingInteraction(`driving:${sessionId}`);

  let musterPoint: string;
  if (type === 'driving_full') {
    musterPoint = interaction.fields.getTextInputValue('musterPoint').trim();
  } else {
    // driving_seats — muster point was stored when the user selected it.
    if (!pending?.musterPoint) {
      await interaction.reply({
        content: '⚠️ Your session context expired. Please try the button again.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    musterPoint = pending.musterPoint;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    await registerDriver(session.id, interaction.user.id, seats, musterPoint);

    const [participants, restaurants, carpools] = await Promise.all([
      getParticipantsForSession(session.id),
      getRestaurantsForSession(session.id),
      getCarpoolsForSession(session.id),
    ]);
    const panel = buildPanel(session, participants, restaurants, carpools);

    // Prefer the stored original button interaction (interaction webhook — always works
    // for Components V2). Fall back to REST patch if the token expired.
    if (pending?.interaction) {
      await pending.interaction.editReply(panel as any);
    } else {
      await refreshPanelMessage(session, client);
    }

    await interaction.editReply({
      content: `✅ You're registered as a driver with **${seats}** seat(s) from **${musterPoint}**.`,
    });
  } catch (err) {
    await interaction.editReply({
      content: `❌ ${err instanceof Error ? err.message : 'Failed to register as driver.'}`,
    });
  }
}

/**
 * [🚌 Need Ride] button — marks the user as needing a ride.
 * customId: carpool:need_ride:<sessionId>
 *
 * Flow:
 *   - Toggle OFF: clears ride request and updates panel.
 *   - Toggle ON: registers ride request, updates panel, then if drivers are available
 *     shows an ephemeral select menu (available drivers + "Any available").
 */
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

  await interaction.deferUpdate();

  const member = interaction.member as GuildMember;

  if (isCurrentlyNeedRide) {
    // Toggle off — clear the ride request and update the panel
    await clearCarpoolRole(session.id, interaction.user.id);
    const [updatedParticipants, restaurants, carpools] = await Promise.all([
      getParticipantsForSession(session.id),
      getRestaurantsForSession(session.id),
      getCarpoolsForSession(session.id),
    ]);
    const panel = buildPanel(session, updatedParticipants, restaurants, carpools);
    await interaction.editReply(panel as any);
    return;
  }

  // Toggle on — register as needing a ride
  await requestRide(
    session.id,
    interaction.user.id,
    interaction.user.username,
    member?.displayName ?? interaction.user.displayName,
  );

  // Fetch fresh data and update the panel immediately
  const [participants, restaurants, carpools] = await Promise.all([
    getParticipantsForSession(session.id),
    getRestaurantsForSession(session.id),
    getCarpoolsForSession(session.id),
  ]);
  const panel = buildPanel(session, participants, restaurants, carpools);
  await interaction.editReply(panel as any);

  // If drivers are available, show an ephemeral select for driver preference
  const available = carpools.filter((c) => c.seats > c.riders.length);
  if (available.length === 0) return;

  // Store the panel interaction so the driver select handler can refresh the panel
  storePendingInteraction(`need_ride:${sessionId}`, interaction);

  const options = available.map((c) => {
    const driverName = participants.find((p) => p.userId === c.driverId)?.displayName ?? 'Driver';
    const seatsLeft = c.seats - c.riders.length;
    return new StringSelectMenuOptionBuilder()
      .setLabel(`🚗 ${driverName} — ${c.musterPoint} (${seatsLeft} seat${seatsLeft !== 1 ? 's' : ''})`.slice(0, 100))
      .setValue(`driver::${c.driverId}`);
  });
  options.push(
    new StringSelectMenuOptionBuilder().setLabel('🎲 Any available').setValue('any'),
  );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`carpool:need_ride_select:${sessionId}`)
      .setPlaceholder('Pick a driver or leave it open')
      .addOptions(options),
  );

  await interaction.followUp({
    content: '🚌 Drivers are available! Pick one or choose "Any available":',
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * Select menu for driver preference in the Need Ride flow.
 * customId: carpool:need_ride_select:<sessionId>
 * Values: 'any' | 'driver::<driverId>'
 */
export async function handleNeedRideSelect(
  interaction: StringSelectMenuInteraction,
  client: Client,
): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const value = interaction.values[0];

  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.reply({ content: '⚠️ Session not active.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();

  if (value !== 'any') {
    const driverId = value.replace(/^driver::/, '');
    const member = interaction.member as GuildMember;
    try {
      await assignRiderToDriver(
        session.id,
        interaction.user.id,
        driverId,
        interaction.user.username,
        member?.displayName ?? interaction.user.displayName,
      );
    } catch (err) {
      await interaction.editReply({
        content: `❌ ${err instanceof Error ? err.message : 'Could not join that carpool.'}`,
        components: [],
      });
      return;
    }
  }

  // Refresh the panel with the updated carpool assignment
  const pending = takePendingInteraction(`need_ride:${sessionId}`);
  const [participants, restaurants, carpools] = await Promise.all([
    getParticipantsForSession(session.id),
    getRestaurantsForSession(session.id),
    getCarpoolsForSession(session.id),
  ]);
  const panel = buildPanel(session, participants, restaurants, carpools);
  if (pending?.interaction) {
    await pending.interaction.editReply(panel as any);
  } else {
    await refreshPanelMessage(session, client);
  }

  const msg =
    value === 'any'
      ? "✅ You're marked as needing a ride. You'll be auto-assigned to a driver soon!"
      : '✅ You\'re assigned to a driver!';
  await interaction.editReply({ content: msg, components: [] });
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

  await interaction.deferUpdate();
  await clearCarpoolRole(session.id, interaction.user.id);

  const [participants, restaurants, carpools] = await Promise.all([
    getParticipantsForSession(session.id),
    getRestaurantsForSession(session.id),
    getCarpoolsForSession(session.id),
  ]);
  const panel = buildPanel(session, participants, restaurants, carpools);
  await interaction.editReply(panel as any);
  await interaction.followUp({ content: '✅ Your carpool role has been cleared.', flags: MessageFlags.Ephemeral });
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

  await interaction.deferUpdate();
  const updated = await autoAssignRides(session.id);

  const [participants, restaurants, carpools] = await Promise.all([
    getParticipantsForSession(session.id),
    getRestaurantsForSession(session.id),
    getCarpoolsForSession(session.id),
  ]);
  const panel = buildPanel(session, participants, restaurants, carpools);
  await interaction.editReply(panel as any);

  const totalAssigned = updated.reduce((sum, c) => sum + c.riders.length, 0);
  await interaction.followUp({
    content: `✅ Auto-assign complete! **${totalAssigned}** rider${totalAssigned !== 1 ? 's' : ''} matched across **${updated.length}** driver${updated.length !== 1 ? 's' : ''}.`,
    flags: MessageFlags.Ephemeral,
  });
}

export { getCarpoolsForSession };
