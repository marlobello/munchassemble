import type { ButtonInteraction, GuildMember } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { AttendanceStatus } from '../types/index.js';
import { rsvp, getParticipantsForSession } from '../services/participantService.js';
import { clearCarpoolRole, getCarpoolsForSession } from '../services/carpoolService.js';
import { getRestaurantsForSession } from '../services/restaurantService.js';
import { getActiveSessionForGuild } from '../services/sessionService.js';
import { buildPanel } from '../ui/panelBuilder.js';

/**
 * Handles the three attendance buttons: ✅ In / 🤔 Maybe / ❌ Out (BR-010).
 * customId format: rsvp:<status>:<sessionId>
 * Note: Driving Alone is transport, not attendance — it routes through carpoolHandler.
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

  // Out or Maybe → clean up any active carpool role before changing attendance.
  // This cancels carpools, unassigns riders, and removes from driver's rider list.
  if (status !== AttendanceStatus.In) {
    await clearCarpoolRole(session.id, interaction.user.id);
  }

  await rsvp(
    session.id,
    interaction.user.id,
    interaction.user.username,
    member?.displayName ?? interaction.user.username,
    status,
  );

  const [participants, restaurants, carpools] = await Promise.all([
    getParticipantsForSession(session.id),
    getRestaurantsForSession(session.id),
    getCarpoolsForSession(session.id),
  ]);

  const panel = buildPanel(session, participants, restaurants, carpools);
  await interaction.update(panel as any);
}
