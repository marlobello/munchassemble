import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  Routes,
} from 'discord.js';
import { getActiveSessionForGuild, lockRestaurant } from '../services/sessionService.js';
import {
  addRestaurant,
  voteForRestaurant,
  getRestaurantsForSession,
} from '../services/restaurantService.js';
import { getTopFavorites } from '../services/favoriteService.js';
import { getParticipantsForSession } from '../services/participantService.js';
import { getCarpoolsForSession } from '../services/carpoolService.js';
import { buildSessionEmbed, buildActionRows, buildVoteSelectMenu } from '../ui/panelBuilder.js';
import { isCreatorOrAdmin, getMember } from '../utils/permissions.js';

/** [🍔 Vote] button — shows a select menu of current restaurants (BR-021). */
export async function handleVoteButton(interaction: ButtonInteraction): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.reply({ content: '⚠️ Session not active.', flags: MessageFlags.Ephemeral });
    return;
  }

  const restaurants = await getRestaurantsForSession(session.id);
  if (restaurants.length === 0) {
    await interaction.reply({
      content: '🍽️ No restaurants added yet. Click **➕ Add Spot** first!',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const selectRow = buildVoteSelectMenu(session.id, restaurants);
  await interaction.reply({
    content: '**Vote for a restaurant:**',
    components: [selectRow],
    flags: MessageFlags.Ephemeral,
  });
}

/** Vote select menu submission (BR-021). */
export async function handleVoteSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const restaurantId = interaction.values[0];

  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.update({ content: '⚠️ Session not active.', components: [] });
    return;
  }

  await voteForRestaurant(session.id, restaurantId, interaction.user.id);

  const [participants, restaurants] = await Promise.all([
    getParticipantsForSession(session.id),
    getRestaurantsForSession(session.id),
  ]);

  // Dismiss the ephemeral vote picker and refresh the main panel
  await interaction.deferUpdate();
  try { await interaction.deleteReply(); } catch { /* ephemeral already gone */ }
  await refreshPanel(interaction, session, participants, restaurants);
}
/** [➕ Add Spot] button — opens modal directly for restaurant name (BR-020). */
export async function handleAddSpotButton(interaction: ButtonInteraction): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.reply({ content: '⚠️ Session not active.', flags: MessageFlags.Ephemeral });
    return;
  }
  await showAddSpotModal(interaction, session.id);
}

/** Select menu from the favorites quick-pick (BR-024). */
export async function handleAddSpotSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const value = interaction.values[0];

  if (value === '__new__') {
    // Modal must be the first response — call directly with no prior update
    await showAddSpotModal(interaction, sessionId);
    return;
  }

  const name = value.replace(/^fav::/, '');
  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.update({ content: '⚠️ Session not active.', components: [] });
    return;
  }

  try {
    await addRestaurant(session.id, session.guildId, name, interaction.user.id);
  } catch (err: unknown) {
    const msg = (err as Error).message ?? '';
    if (msg.startsWith('DUPLICATE:')) {
      await interaction.update({ content: `⚠️ **${name}** is already on the list!`, components: [] });
      return;
    }
    throw err;
  }
  await interaction.update({ content: `✅ **${name}** added!`, components: [] });
  await refreshPanelFromInteraction(interaction, session);
}

/** Modal for free-text restaurant entry. */
async function showAddSpotModal(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  sessionId: string,
): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId(`modal:add_spot:${sessionId}`)
    .setTitle('➕ Add Restaurant');
  const nameInput = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Restaurant name')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80);
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput));
  await interaction.showModal(modal);
}

/** Handle the Add Spot modal submission (BR-020). */
export async function handleAddSpotModal(interaction: ModalSubmitInteraction): Promise<void> {
  const sessionId = interaction.customId.split(':')[2];
  const name = interaction.fields.getTextInputValue('name').trim();

  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.reply({ content: '⚠️ Session not active.', flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    await addRestaurant(session.id, session.guildId, name, interaction.user.id);
  } catch (err: unknown) {
    const msg = (err as Error).message ?? '';
    if (msg.startsWith('DUPLICATE:')) {
      await interaction.reply({ content: `⚠️ **${name}** is already on the list!`, flags: MessageFlags.Ephemeral });
      return;
    }
    throw err;
  }
  await interaction.reply({ content: `✅ **${name}** added to the vote!`, flags: MessageFlags.Ephemeral });
  await refreshPanelFromInteraction(interaction, session);
}

/** [🔒 Lock Choice] button — locks the leading restaurant (BR-023). */
export async function handleLockChoiceButton(interaction: ButtonInteraction): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.reply({ content: '⚠️ Session not active.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (!isCreatorOrAdmin(interaction.user.id, getMember(interaction), session)) {
    await interaction.reply({
      content: '🚫 Only the session creator or a server admin can lock the restaurant.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const restaurants = await getRestaurantsForSession(session.id);
  if (restaurants.length === 0) {
    await interaction.reply({
      content: '🍽️ No restaurants to lock. Add some first!',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const leader = [...restaurants].sort((a, b) => b.votes.length - a.votes.length)[0];
  const updatedSession = await lockRestaurant(session, leader.id);

  const [participants, carpools] = await Promise.all([
    getParticipantsForSession(session.id),
    getCarpoolsForSession(session.id),
  ]);
  const embed = buildSessionEmbed(updatedSession, participants, restaurants, carpools);
  const rows = buildActionRows(updatedSession);

  await interaction.update({ embeds: [embed], components: rows });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function refreshPanel(
  interaction: StringSelectMenuInteraction,
  session: import('../types/index.js').LunchSession,
  participants: import('../types/index.js').Participant[],
  restaurants: import('../types/index.js').Restaurant[],
): Promise<void> {
  if (!session.messageId) return;
  try {
    const carpools = await getCarpoolsForSession(session.id);
    const embed = buildSessionEmbed(session, participants, restaurants, carpools);
    const rows = buildActionRows(session);
    // Use REST PATCH directly — avoids needing ReadMessageHistory to fetch first
    await interaction.client.rest.patch(
      Routes.channelMessage(interaction.channelId, session.messageId),
      { body: { embeds: [embed.toJSON()], components: rows.map((r) => r.toJSON()) } },
    );
  } catch (err) {
    console.error('[panel] Failed to refresh panel after vote:', err);
  }
}

async function refreshPanelFromInteraction(
  interaction: ModalSubmitInteraction | StringSelectMenuInteraction,
  session: import('../types/index.js').LunchSession,
): Promise<void> {
  const [participants, restaurants] = await Promise.all([
    getParticipantsForSession(session.id),
    getRestaurantsForSession(session.id),
  ]);
  await refreshPanel(interaction as StringSelectMenuInteraction, session, participants, restaurants);
}
