import type { Client, TextChannel } from 'discord.js';
import type { LunchSession } from '../types/index.js';
import { getParticipantsForSession } from '../services/participantService.js';
import { getRestaurantsForSession } from '../services/restaurantService.js';
import { getCarpoolsForSession } from '../services/carpoolService.js';
import { buildPanel } from '../ui/panelBuilder.js';

/**
 * Fetches all current session data and edits the live panel message.
 * Used by handlers that operate on ephemeral responses or modals and therefore
 * cannot call interaction.update() on the original panel directly.
 *
 * Uses channel.messages.fetch() + message.edit() instead of client.rest.patch()
 * to ensure discord.js's serialization pipeline handles Components v2 correctly.
 *
 * IMPORTANT: Always call interaction.update()/reply()/deferReply() BEFORE this
 * function so the interaction response window is not exceeded.
 */
export async function refreshPanelMessage(session: LunchSession, client: Client): Promise<void> {
  if (!session.messageId) return;

  const [participants, restaurants, carpools] = await Promise.all([
    getParticipantsForSession(session.id),
    getRestaurantsForSession(session.id),
    getCarpoolsForSession(session.id),
  ]);

  const panel = buildPanel(session, participants, restaurants, carpools);

  try {
    const rawChannel = await client.channels.fetch(session.channelId);
    if (!rawChannel?.isTextBased()) {
      console.warn('[panelRefresh] Channel not text-based or not found:', session.channelId);
      return;
    }
    const message = await (rawChannel as TextChannel).messages.fetch(session.messageId);
    await message.edit(panel as any);
  } catch (err) {
    console.error('[panelRefresh] Failed to refresh panel message:', err);
  }
}
