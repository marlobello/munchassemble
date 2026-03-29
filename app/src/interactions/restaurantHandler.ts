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
} from 'discord.js';
import { getActiveSessionForGuild, lockRestaurant } from '../services/sessionService.js';
import {
  addRestaurant,
  voteForRestaurant,
  getRestaurantsForSession,
} from '../services/restaurantService.js';
import { getTopFavorites } from '../services/favoriteService.js';
import { getParticipantsForSession } from '../services/participantService.js';
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

  const votedFor = restaurants.find((r) => r.id === restaurantId);

  // Update the ephemeral vote message
  await interaction.update({
    content: `✅ Vote recorded for **${votedFor?.name ?? 'unknown'}**!`,
    components: [],
  });

  // Also refresh the main panel
  await refreshPanel(interaction, session, participants, restaurants);
}

/** [➕ Add Spot] button — shows quick-select favorites + free-text option (BR-020/BR-024). */
export async function handleAddSpotButton(interaction: ButtonInteraction): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.reply({ content: '⚠️ Session not active.', flags: MessageFlags.Ephemeral });
    return;
  }

  const favorites = await getTopFavorites(interaction.guildId!, 10);

  if (favorites.length > 0) {
    // Show quick-select from favorites + a "Add new..." option
    const options = favorites.map((f) =>
      new StringSelectMenuOptionBuilder().setLabel(f.name).setValue(`fav::${f.name}`),
    );
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel('✏️ Type a new restaurant name...')
        .setValue('__new__'),
    );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`restaurant:add_select:${session.id}`)
        .setPlaceholder('Pick a favorite or add new')
        .addOptions(options),
    );
    await interaction.reply({ content: '🍽️ Pick a spot:', components: [row], flags: MessageFlags.Ephemeral });
  } else {
    // No favorites yet — go straight to modal
    await showAddSpotModal(interaction, session.id);
  }
}

/** Select menu from the favorites quick-pick (BR-024). */
export async function handleAddSpotSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const value = interaction.values[0];

  if (value === '__new__') {
    // User wants to type a new name — show the modal
    await interaction.update({ content: 'Opening form...', components: [] });
    await showAddSpotModal(interaction, sessionId);
    return;
  }

  const name = value.replace(/^fav::/, '');
  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.update({ content: '⚠️ Session not active.', components: [] });
    return;
  }

  await addRestaurant(session.id, session.guildId, name, interaction.user.id);
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

  await addRestaurant(session.id, session.guildId, name, interaction.user.id);
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

  const [participants] = await Promise.all([getParticipantsForSession(session.id)]);
  const embed = buildSessionEmbed(updatedSession, participants, restaurants);
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
  try {
    const channel = interaction.channel;
    if (!channel || !channel.isTextBased()) return;
    const panelMsg = await channel.messages.fetch(session.messageId);
    if (!panelMsg) return;
    const embed = buildSessionEmbed(session, participants, restaurants);
    const rows = buildActionRows(session);
    await panelMsg.edit({ embeds: [embed], components: rows });
  } catch {
    // Non-critical — panel may already be updated by another interaction
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
