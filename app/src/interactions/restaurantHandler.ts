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
import { getCarpoolsForSession } from '../services/carpoolService.js';
import { buildPanel, buildVoteSelectMenu } from '../ui/panelBuilder.js';
import { isCreatorOrAdmin, getMember } from '../utils/permissions.js';
import { refreshPanelMessage } from '../utils/panelRefresh.js';
import { voteBlockedReason } from '../utils/stateRules.js';
import type { Client } from 'discord.js';

/** [🍔 Vote] button — shows a select menu of current restaurants (BR-021). */
export async function handleVoteButton(interaction: ButtonInteraction): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.reply({ content: '⚠️ Session not active.', flags: MessageFlags.Ephemeral });
    return;
  }

  // State machine: Out users cannot vote
  const { getParticipant } = await import('../db/repositories/participantRepo.js');
  const participant = await getParticipant(session.id, interaction.user.id);
  const blocked = voteBlockedReason(participant);
  if (blocked) {
    await interaction.reply({ content: blocked, flags: MessageFlags.Ephemeral });
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
  client: Client,
): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const restaurantId = interaction.values[0];

  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.update({ content: '⚠️ Session not active.', components: [] });
    return;
  }

  await voteForRestaurant(session.id, restaurantId, interaction.user.id);

  // Dismiss the ephemeral picker immediately (direct update — reliable on mobile)
  // then REST PATCH the main panel so the vote count updates for everyone.
  await interaction.update({ content: '✅ Vote recorded!', components: [] });
  await refreshPanelMessage(session, client);
}
/** [➕ Add Spot] button — shows favorites not already in session + free-text option (BR-020/BR-024). */
export async function handleAddSpotButton(interaction: ButtonInteraction): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.reply({ content: '⚠️ Session not active.', flags: MessageFlags.Ephemeral });
    return;
  }

  const [favorites, existing] = await Promise.all([
    getTopFavorites(interaction.guildId!, 23),
    getRestaurantsForSession(session.id),
  ]);

  const existingNames = new Set(existing.map((r) => r.name.toLowerCase()));
  const newFavorites = favorites.filter((f) => !existingNames.has(f.name.toLowerCase()));

  if (newFavorites.length === 0) {
    // No favorites to show — go straight to modal
    await showAddSpotModal(interaction, session.id);
    return;
  }

  const options = newFavorites.map((f) =>
    new StringSelectMenuOptionBuilder().setLabel(f.name).setValue(`fav::${f.name}`),
  );
  options.push(
    new StringSelectMenuOptionBuilder()
      .setLabel('✏️ Type a new restaurant name...')
      .setValue('__new__'),
  );

  const alreadyAdded = existing.length > 0
    ? `\nAlready on the list: ${existing.map((r) => `**${r.name}**`).join(', ')}`
    : '';

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`restaurant:add_select:${session.id}`)
      .setPlaceholder('Pick a favourite or add new')
      .addOptions(options),
  );
  await interaction.reply({
    content: `🍽️ Pick a spot:${alreadyAdded}`,
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

/** Select menu from the favorites quick-pick (BR-024). */
export async function handleAddSpotSelect(
  interaction: StringSelectMenuInteraction,
  client: Client,
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
  // Dismiss the ephemeral picker immediately, then refresh the main panel.
  await interaction.update({ content: `✅ **${name}** added!`, components: [] });
  await refreshPanelMessage(session, client);
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
export async function handleAddSpotModal(
  interaction: ModalSubmitInteraction,
  client: Client,
): Promise<void> {
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
  await refreshPanelMessage(session, client);
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
  const panel = buildPanel(updatedSession, participants, restaurants, carpools);
  await interaction.update(panel as any);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
