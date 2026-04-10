import type { Client } from 'discord.js';
import { Routes } from 'discord.js';
import type { LunchSession } from '../types/index.js';
import { getParticipantsForSession } from '../services/participantService.js';
import { getRestaurantsForSession } from '../services/restaurantService.js';
import { getCarpoolsForSession } from '../services/carpoolService.js';
import { buildPanel } from '../ui/panelBuilder.js';

/**
 * Fetches all current session data and edits the live panel message via REST.
 *
 * Used as a fallback by handlers that cannot carry the original ButtonInteraction
 * through their flow (e.g. Edit Time modal, Switch, Auto-Assign, and any path
 * where showModal() consumed the button token before it could be stored).
 *
 * Uses client.rest.patch() with explicitly serialised components because
 * discord.js's message.edit() pipeline expects ActionRowBuilder[] in the
 * components array and does not correctly serialise top-level Components V2
 * containers (ContainerBuilder). Calling .toJSON() before the REST call
 * bypasses that limitation.
 *
 * IMPORTANT: Always call interaction.deferReply()/reply() BEFORE this function
 * so the interaction's 3-second acknowledgement window is not exceeded.
 */
export async function refreshPanelMessage(session: LunchSession, client: Client): Promise<void> {
  if (!session.messageId) return;

  const [participants, restaurants, carpools] = await Promise.all([
    getParticipantsForSession(session.id),
    getRestaurantsForSession(session.id),
    getCarpoolsForSession(session.id),
  ]);

  const panel = buildPanel(session, participants, restaurants, carpools);

  // Explicitly serialise ContainerBuilder components before the REST patch.
  const body = {
    flags: panel.flags,
    components: panel.components.map((c: any) =>
      typeof c.toJSON === 'function' ? c.toJSON() : c,
    ),
  };

  try {
    await client.rest.patch(
      Routes.channelMessage(session.channelId, session.messageId),
      { body },
    );
  } catch (err) {
    console.error('[panelRefresh] Failed to refresh panel message:', err);
  }
}
