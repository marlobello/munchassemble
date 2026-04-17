import type { Client } from 'discord.js';
import { Routes } from 'discord.js';
import type { LunchSession, Participant } from '../types/index.js';
import { SessionStatus } from '../types/index.js';
import { getParticipantsForSession } from '../services/participantService.js';
import { getRestaurantsForSession } from '../services/restaurantService.js';
import { getCarpoolsForSession } from '../services/carpoolService.js';
import { getNoPingListForGuild } from '../db/repositories/noPingRepo.js';
import { buildPanel } from '../ui/panelBuilder.js';

/**
 * Returns display names of guild members who have not responded to the session.
 * Excludes bots, users on the noping list, and anyone already in the participants list.
 *
 * Uses the local guild member cache (pre-populated at startup in index.ts)
 * instead of guild.members.fetch() to avoid gateway REQUEST_GUILD_MEMBERS rate limits.
 */
export async function fetchNoResponseNames(
  guildId: string,
  participants: Participant[],
  client: Client,
): Promise<string[]> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    console.warn('[panelRefresh] Guild not in cache:', guildId);
    return [];
  }

  // Use the local cache instead of fetch() — avoids gateway opcode 8 rate limits.
  // The GuildMembers intent ensures the cache is populated on connect for small guilds.
  const members = guild.members.cache;
  if (members.size === 0) {
    console.warn('[panelRefresh] Guild member cache is empty; skipping No Response names');
    return [];
  }

  const noPingList = await getNoPingListForGuild(guildId);

  const participantIds = new Set(participants.map((p) => p.userId));
  const noPingIds = new Set(noPingList.map((e) => e.userId));

  return [...members.values()]
    .filter((m) => !m.user.bot && !noPingIds.has(m.id) && !participantIds.has(m.id))
    .map((m) => m.displayName)
    .sort();
}

/**
 * Fetches all current session data and edits the live panel message via REST.
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
  if (!session.messageId) {
    console.warn('[panelRefresh] No messageId on session', session.id);
    return;
  }

  console.log('[panelRefresh] Refreshing panel for session', session.id);

  const [participants, restaurants, carpools] = await Promise.all([
    getParticipantsForSession(session.id),
    getRestaurantsForSession(session.id),
    getCarpoolsForSession(session.id),
  ]);

  let noResponseNames: string[] = [];
  if (session.status === SessionStatus.Planning) {
    try {
      noResponseNames = await fetchNoResponseNames(session.guildId, participants, client);
    } catch (err) {
      console.error('[panelRefresh] fetchNoResponseNames failed (continuing without):', err);
    }
  }

  const panel = buildPanel(session, participants, restaurants, carpools, noResponseNames);

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
    console.log('[panelRefresh] Panel updated successfully for session', session.id);
  } catch (err) {
    console.error('[panelRefresh] REST patch failed:', err);
  }
}
