import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
  Client,
} from 'discord.js';
import { startSession, getActiveSessionForGuild, attachMessageId } from '../services/sessionService.js';
import { addRestaurant } from '../services/restaurantService.js';
import { getParticipantsForSession } from '../services/participantService.js';
import { getCarpoolsForSession } from '../services/carpoolService.js';
import { buildPanel } from '../ui/panelBuilder.js';
import { scheduleReminders } from '../utils/scheduler.js';

export const data = new SlashCommandBuilder()
  .setName('munchassemble')
  .setDescription('Kick off a lunch coordination session for the group 🍔');

/** Called when a user types /munchassemble. Opens a modal (BR-001). */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  // Check for existing active session first
  const existing = await getActiveSessionForGuild(interaction.guildId!);
  if (existing) {
    await interaction.reply({
      content: `⚠️ There's already an active session for today (${existing.date}). Finalize it first with the **🔒 Finalize Plan** button on the session panel.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const today = new Date().toISOString().split('T')[0];

  const modal = new ModalBuilder()
    .setCustomId('modal:create_session')
    .setTitle('🍔 Create Lunch Session');

  const dateInput = new TextInputBuilder()
    .setCustomId('date')
    .setLabel('Date (YYYY-MM-DD)')
    .setStyle(TextInputStyle.Short)
    .setValue(today)
    .setRequired(true);

  const lunchTimeInput = new TextInputBuilder()
    .setCustomId('lunchTime')
    .setLabel('Lunch time (HH:MM, 24h)')
    .setStyle(TextInputStyle.Short)
    .setValue('11:15')
    .setRequired(true);

  const departTimeInput = new TextInputBuilder()
    .setCustomId('departTime')
    .setLabel('Departure time (HH:MM, 24h)')
    .setStyle(TextInputStyle.Short)
    .setValue('11:00')
    .setRequired(true);

  const restaurantInput = new TextInputBuilder()
    .setCustomId('initialRestaurant')
    .setLabel('Initial restaurant suggestion (optional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const notesInput = new TextInputBuilder()
    .setCustomId('notes')
    .setLabel('Notes (optional, e.g. "quick lunch")')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(dateInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(lunchTimeInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(departTimeInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(restaurantInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput),
  );

  await interaction.showModal(modal);
}

/** Handle the modal submission from /munchassemble. */
export async function handleCreateSessionModal(
  interaction: import('discord.js').ModalSubmitInteraction,
  client: Client,
): Promise<void> {
  const date = interaction.fields.getTextInputValue('date').trim();
  const lunchTime = interaction.fields.getTextInputValue('lunchTime').trim();
  const departTime = interaction.fields.getTextInputValue('departTime').trim();
  const initialRestaurant = interaction.fields.getTextInputValue('initialRestaurant').trim();
  const notes = interaction.fields.getTextInputValue('notes').trim();

  // Validate date format and ensure it is not in the past
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    await interaction.reply({
      content: '❌ Invalid date format. Use YYYY-MM-DD (e.g. 2026-04-01).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const today = new Date().toISOString().split('T')[0];
  if (date < today) {
    await interaction.reply({
      content: `❌ You can't schedule a session in the past. Today is **${today}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Validate time formats
  const timeRegex = /^\d{1,2}:\d{2}$/;
  if (!timeRegex.test(lunchTime) || !timeRegex.test(departTime)) {
    await interaction.reply({
      content: '❌ Invalid time format. Use HH:MM (e.g. 11:15).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Defer immediately — we need to post the panel
  await interaction.deferReply();

  try {
    const session = await startSession({
      guildId: interaction.guildId!,
      channelId: interaction.channelId ?? '',
      creatorId: interaction.user.id,
      date,
      lunchTime,
      departTime,
      notes: notes || undefined,
    });

    const restaurants = initialRestaurant
      ? [await addRestaurant(session.id, session.guildId, initialRestaurant, interaction.user.id)]
      : [];

    const participants = await getParticipantsForSession(session.id);
    const carpools = await getCarpoolsForSession(session.id);
    const panel = buildPanel(session, participants, restaurants, carpools);

    const message = await interaction.editReply(panel as any);

    // Store the message ID so handlers can edit the panel later
    const attached = await attachMessageId(session, message.id);

    // Schedule T-15 and T-5 reminders (Phase 3)
    scheduleReminders(attached, client);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await interaction.editReply({ content: `❌ ${msg}` });
  }
}
