import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import {
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
import { getRestaurantOptions } from '../services/restaurantOptionService.js';
import { isCreatorOrAdmin, getMember } from '../utils/permissions.js';
import { refreshPanelMessage } from '../utils/panelRefresh.js';
import { voteBlockedReason } from '../utils/stateRules.js';
import { getParticipant } from '../db/repositories/participantRepo.js';
import { DuplicateError } from '../utils/errors.js';
import { storePendingInteraction, takePendingInteraction } from '../utils/pendingInteractions.js';
import type { Client } from 'discord.js';

/**
 * [🗳️ RestaurantName (N)] inline vote button — direct vote, no ephemeral (BR-021).
 * customId: restaurant:vote_for:<sessionId>:<restaurantId>
 */
export async function handleVoteForButton(
  interaction: ButtonInteraction,
  client: Client,
): Promise<void> {
  const parts = interaction.customId.split(':');
  const sessionId = parts[2];
  const restaurantId = parts[3];

  // State machine check is synchronous — do it before deferring
  const participant = await getParticipant(sessionId, interaction.user.id);
  const blocked = voteBlockedReason(participant);
  if (blocked) {
    await interaction.reply({ content: blocked, flags: MessageFlags.Ephemeral });
    return;
  }

  // Acknowledge immediately — all DB work happens after
  await interaction.deferUpdate();

  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    // Session gone — panel is stale, nothing to update
    return;
  }

  await voteForRestaurant(session.id, restaurantId, interaction.user.id);

  await refreshPanelMessage(session, client);
}

/** [➕ Suggest Spot] button — shows configured restaurant options not already in session (BR-020). */
export async function handleAddSpotButton(interaction: ButtonInteraction): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.reply({ content: '⚠️ Session not active.', flags: MessageFlags.Ephemeral });
    return;
  }

  const [configuredOptions, existing] = await Promise.all([
    getRestaurantOptions(interaction.guildId!),
    getRestaurantsForSession(session.id),
  ]);

  if (configuredOptions.length === 0) {
    await interaction.reply({
      content:
        '🍽️ No restaurant options configured. An admin can add some with `/munchassemble-config restaurant add`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const existingNames = new Set(existing.map((r) => r.name.toLowerCase()));
  const available = configuredOptions.filter((o) => !existingNames.has(o.name.toLowerCase()));

  if (available.length === 0) {
    await interaction.reply({
      content: '🍽️ All configured restaurants are already on the list!',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const options = available.map((o) =>
    new StringSelectMenuOptionBuilder().setLabel(o.name).setValue(o.name),
  );

  const alreadyAdded =
    existing.length > 0
      ? `\nAlready on the list: ${existing.map((r) => `**${r.name}**`).join(', ')}`
      : '';

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`restaurant:add_select:${session.id}`)
      .setPlaceholder('Pick a restaurant to add')
      .addOptions(options),
  );

  // Defer the panel button and store it so the select handler can update the panel directly.
  await interaction.deferUpdate();
  storePendingInteraction(`add_spot:${sessionId}`, interaction);

  await interaction.followUp({
    content: `🍽️ Pick a spot:${alreadyAdded}`,
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

/** Select menu from the configured restaurant list (BR-020). */
export async function handleAddSpotSelect(
  interaction: StringSelectMenuInteraction,
  client: Client,
): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const name = interaction.values[0];

  // Defer immediately before any DB work to stay within the 3s window.
  await interaction.deferUpdate();

  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.editReply({ content: '⚠️ Session not active.', components: [] });
    return;
  }

  try {
    await addRestaurant(session.id, session.guildId, name, interaction.user.id);
  } catch (err: unknown) {
    if (err instanceof DuplicateError) {
      await interaction.editReply({ content: `⚠️ **${name}** is already on the list!`, components: [] });
      return;
    }
    throw err;
  }

  // Update the panel via the known-working REST patch endpoint.
  // Consume the pending interaction to clean up the store (not needed for editReply any more).
  takePendingInteraction(`add_spot:${sessionId}`);
  await refreshPanelMessage(session, client);

  await interaction.editReply({ content: `✅ **${name}** added!`, components: [] });
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

  await interaction.deferUpdate();

  const leader = [...restaurants].sort((a, b) => b.votes.length - a.votes.length)[0];
  const updatedSession = await lockRestaurant(session, leader.id);

  await refreshPanelMessage(updatedSession, interaction.client);
}

/** [🎲 Tie Break] button — randomly picks a winner among tied restaurants (Issue #3). */
export async function handleTieBreakButton(interaction: ButtonInteraction): Promise<void> {
  const [, , sessionId] = interaction.customId.split(':');
  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.reply({ content: '⚠️ Session not active.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (!isCreatorOrAdmin(interaction.user.id, getMember(interaction), session)) {
    await interaction.reply({
      content: '🚫 Only the session creator or a server admin can break a tie.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const restaurants = await getRestaurantsForSession(session.id);
  const maxVotes = Math.max(...restaurants.map((r) => r.votes.length));
  const tied = restaurants.filter((r) => r.votes.length === maxVotes && maxVotes > 0);

  if (tied.length < 2) {
    await interaction.reply({
      content: '⚠️ No tie to break — use 🔒 Lock Choice instead.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();

  const winner = tied[Math.floor(Math.random() * tied.length)];
  const updatedSession = await lockRestaurant(session, winner.id);

  await refreshPanelMessage(updatedSession, interaction.client);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

