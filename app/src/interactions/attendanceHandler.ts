import type { ButtonInteraction, GuildMember } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { AttendanceStatus } from '../types/index.js';
import { rsvp, getParticipantsForSession } from '../services/participantService.js';
import { getRestaurantsForSession } from '../services/restaurantService.js';
import { getActiveSessionForGuild } from '../services/sessionService.js';
import { buildSessionEmbed, buildActionRows } from '../ui/panelBuilder.js';

/**
 * Handles the three RSVP buttons: ✅ In / 🤔 Maybe / ❌ Out (BR-010).
 * customId format: rsvp:<status>:<sessionId>
 */
export async function handleAttendanceButton(interaction: ButtonInteraction): Promise<void> {
  const [, statusStr, sessionId] = interaction.customId.split(':');
  const status = statusStr as AttendanceStatus;

  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    await interaction.reply({
      content: '⚠️ This session is no longer active.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const member = interaction.member as GuildMember;
  await rsvp(
    session.id,
    interaction.user.id,
    interaction.user.username,
    member?.displayName ?? interaction.user.username,
    status,
  );

  const [participants, restaurants] = await Promise.all([
    getParticipantsForSession(session.id),
    getRestaurantsForSession(session.id),
  ]);

  const embed = buildSessionEmbed(session, participants, restaurants);
  const rows = buildActionRows(session);

  // Update the panel in-place
  await interaction.update({ embeds: [embed], components: rows });
}
