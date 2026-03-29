import {
  ActionRowBuilder,
  ButtonInteraction,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { getActiveSessionForGuild } from '../services/sessionService.js';
import { getMusterPoints } from '../services/musterService.js';
import { getParticipant, upsertParticipant } from '../db/repositories/participantRepo.js';
import { getCarpoolsForSession } from '../services/carpoolService.js';
import { getParticipantsForSession } from '../services/participantService.js';
import { getRestaurantsForSession } from '../services/restaurantService.js';
import { buildSessionEmbed, buildActionRows, SELECT } from '../ui/panelBuilder.js';
import type { Client } from 'discord.js';

/** [📍 Muster Point] button — shows muster point select for the user. */
export async function handleMusterButton(interaction: ButtonInteraction, client: Client): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.reply({ content: '⚠️ Session not active.', flags: MessageFlags.Ephemeral });
    return;
  }

  const musterPoints = await getMusterPoints(session.guildId);
  if (musterPoints.length === 0) {
    await interaction.reply({
      content: '⚠️ No muster points configured. Ask an admin to add some with `/munchassemble-config musterpoint add <name>`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const options = musterPoints.map((mp) =>
    new StringSelectMenuOptionBuilder().setLabel(mp.name).setValue(mp.name),
  );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(SELECT.muster(sessionId))
      .setPlaceholder('Select your muster/meeting point')
      .addOptions(options),
  );

  await interaction.reply({
    content: '📍 Where will you meet up?',
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

/** Handle muster point select menu submission. */
export async function handleMusterSelect(
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

  const p = await getParticipant(session.id, interaction.user.id);
  if (p) {
    await upsertParticipant({ ...p, musterPoint, updatedAt: new Date().toISOString() });
  }

  await refreshPanel(interaction, session, client);
  await interaction.update({
    content: `✅ Your muster point is set to **${musterPoint}**.`,
    components: [],
  });
}

async function refreshPanel(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
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

  if (session.messageId && interaction.channel) {
    try {
      const msg = await interaction.channel.messages.fetch(session.messageId);
      await msg.edit({ embeds: [embed], components: rows });
    } catch {
      // Panel message may have been deleted
    }
  }
}
