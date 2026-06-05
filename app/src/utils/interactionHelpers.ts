import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { MessageFlags } from 'discord.js';
import type { LunchSession } from '../types/index.js';
import { getActiveSessionForGuild } from '../services/sessionService.js';

type RepliableInteraction =
  | ButtonInteraction
  | ModalSubmitInteraction
  | StringSelectMenuInteraction;

/**
 * Resolves the guild's active session and verifies it matches the interaction's
 * sessionId. On mismatch (no active session, or a different/stale one), replies
 * with the standard ephemeral warning and returns null so the caller can early-return.
 *
 * Only safe for handlers that have NOT yet deferred — it uses `interaction.reply`.
 */
export async function requireActiveSession(
  interaction: RepliableInteraction,
  sessionId: string,
): Promise<LunchSession | null> {
  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.reply({ content: '⚠️ Session not active.', flags: MessageFlags.Ephemeral });
    return null;
  }
  return session;
}
