import {
  ActionRowBuilder,
  ButtonInteraction,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  Routes,
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
import { buildPanel, SELECT } from '../ui/panelBuilder.js';
import { TransportStatus } from '../types/index.js';
import type { Client } from 'discord.js';

export const CARPOOL_SELECT = {
  needRide: (sid: string) => `carpool:need_ride:${sid}`,
  musterDrive: (sid: string) => `carpool:muster_drive:${sid}`,
};

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
  const [participants] = await Promise.all([getParticipantsForSession(session.id)]);
  const existing = participants.find((p) => p.userId === interaction.user.id);

  // Toggle: if already DrivingAlone, clear it; otherwise set it
  const newTransport =
    existing?.transportStatus === TransportStatus.DrivingAlone
      ? TransportStatus.None
      : TransportStatus.DrivingAlone;

  await setTransport(
    session.id,
    interaction.user.id,
    interaction.user.username,
    member?.displayName ?? interaction.user.displayName,
    newTransport,
  );

  await refreshPanel(interaction, session, client);
  await interaction.deferUpdate();
}


export async function handleDrivingButton(interaction: ButtonInteraction): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');

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

/** [🚌 Need Ride] button — shows available Can Drive people with open seats. */
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

  const [carpools, participants] = await Promise.all([
    getCarpoolsForSession(session.id),
    getParticipantsForSession(session.id),
  ]);

  const availableDrivers = carpools.filter((c) => c.seats > c.riders.length);

  if (availableDrivers.length === 0) {
    // No drivers yet — just register as needing a ride
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
      content: `✅ You've been marked as needing a ride. No drivers with open seats yet — you'll be assigned when one registers.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const options = availableDrivers.map((c) => {
    const driverName = participants.find((p) => p.userId === c.driverId)?.displayName ?? `<@${c.driverId}>`;
    const seatsLeft = c.seats - c.riders.length;
    return new StringSelectMenuOptionBuilder()
      .setLabel(`${driverName} — ${c.musterPoint}`)
      .setDescription(`${seatsLeft} seat${seatsLeft !== 1 ? 's' : ''} available`)
      .setValue(c.driverId);
  });

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(SELECT.carpoolNeedRide(sessionId))
      .setPlaceholder('Pick a driver to ride with')
      .addOptions(options),
  );

  await interaction.reply({
    content: '🚗 Choose your driver:',
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

/** Handle driver selection for a rider. */
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

  const driverId = interaction.values[0];
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
    await interaction.update({
      content: `❌ ${err instanceof Error ? err.message : 'Could not assign ride.'}`,
      components: [],
    });
    return;
  }

  // Fetch driver name for confirmation
  const [participants] = await Promise.all([getParticipantsForSession(session.id)]);
  const driverName = participants.find((p) => p.userId === driverId)?.displayName ?? 'your driver';

  await refreshPanel(interaction, session, client);
  await interaction.update({
    content: `✅ You're riding with **${driverName}**!`,
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

  const panel = buildPanel(session, participants, restaurants, carpools);

  // Edit the original panel message via REST PATCH (avoids ReadMessageHistory permission)
  if (session.messageId) {
    try {
      await client.rest.patch(
        Routes.channelMessage(session.channelId, session.messageId),
        { body: { flags: panel.flags, components: panel.components.map((c) => c.toJSON()) } },
      );
    } catch {
      // Panel message may have been deleted — not critical
    }
  }
}

export { getCarpoolsForSession };
