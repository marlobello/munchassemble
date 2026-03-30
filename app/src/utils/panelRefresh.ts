import { Routes } from 'discord.js';
import type { Client } from 'discord.js';
import type { LunchSession } from '../types/index.js';
import { getParticipantsForSession } from '../services/participantService.js';
import { getRestaurantsForSession } from '../services/restaurantService.js';
import { getCarpoolsForSession } from '../services/carpoolService.js';
import { buildPanel } from '../ui/panelBuilder.js';

/**
 * Fetches all current session data and REST-PATCHes the live panel message.
 * Used by handlers that operate on ephemeral responses or modals and therefore
 * cannot call interaction.update() on the original panel directly.
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
    await client.rest.patch(
      Routes.channelMessage(session.channelId, session.messageId),
      { body: { flags: panel.flags, components: panel.components.map((c) => c.toJSON()) } },
    );
  } catch {
    // Panel message may have been deleted — not critical
  }
}
