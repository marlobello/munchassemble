import type { ButtonInteraction, GuildMember } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { AttendanceStatus } from '../types/index.js';
import { rsvp, getParticipantsForSession } from '../services/participantService.js';
import { clearCarpoolRole, clearCanDriveRoleOnly, getCarpoolsForSession } from '../services/carpoolService.js';
import { removeVote, getRestaurantsForSession } from '../services/restaurantService.js';
import { getActiveSessionForGuild } from '../services/sessionService.js';
import { buildPanel } from '../ui/panelBuilder.js';

/**
 * Handles the three attendance buttons: ✅ In / 🤔 Maybe / ❌ Out (BR-010).
 * customId format: rsvp:<status>:<sessionId>
 *
 * Cascade rules on attendance change:
 *   → Out:   clear ALL transport (cancel any CanDrive carpool, remove from NeedRide) + remove vote
 *   → Maybe: clear CanDrive ONLY (cancel hosted carpool + unassign riders); keep DrivingAlone/NeedRide; keep vote
 *   → In:    no cascade
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

  // Acknowledge immediately to stay within the 3s Discord window;
  // all DB work happens after this point.
  await interaction.deferUpdate();

  const member = interaction.member as GuildMember;

  // Cascade effects based on new attendance status
  if (status === AttendanceStatus.Out) {
    // Out: clear ALL transport (cancel CanDrive carpool, remove from any carpool) + remove vote
    await Promise.all([
      clearCarpoolRole(session.id, interaction.user.id),
      removeVote(session.id, interaction.user.id),
    ]);
  } else if (status === AttendanceStatus.Maybe) {
    // Maybe: only cancel hosted carpool (CanDrive); DrivingAlone/NeedRide are permitted with Maybe
    await clearCanDriveRoleOnly(session.id, interaction.user.id);
  }
  // In: no cascade — user can freely choose transport and vote

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
  await interaction.editReply(panel as any);
}
