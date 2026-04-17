import type { ButtonInteraction, GuildMember } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { AttendanceStatus } from '../types/index.js';
import { rsvp } from '../services/participantService.js';
import { clearCarpoolRole, clearCanDriveRoleOnly } from '../services/carpoolService.js';
import { removeVote } from '../services/restaurantService.js';
import { getActiveSessionForGuild } from '../services/sessionService.js';
import { refreshPanelMessage } from '../utils/panelRefresh.js';

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
  console.log(`[attendance] ${interaction.user.username} clicked ${status} for session ${sessionId}`);

  const session = await getActiveSessionForGuild(interaction.guildId!);
  if (!session || session.id !== sessionId) {
    console.warn('[attendance] Session not found or mismatch:', session?.id, sessionId);
    await interaction.reply({
      content: '⚠️ This session is no longer active.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Acknowledge immediately to stay within the 3s Discord window;
  // all DB work happens after this point.
  await interaction.deferUpdate();
  console.log('[attendance] Deferred update, performing DB work...');

  const member = interaction.member as GuildMember;

  // Cascade effects based on new attendance status
  if (status === AttendanceStatus.Out) {
    await Promise.all([
      clearCarpoolRole(session.id, interaction.user.id),
      removeVote(session.id, interaction.user.id),
    ]);
  } else if (status === AttendanceStatus.Maybe) {
    await clearCanDriveRoleOnly(session.id, interaction.user.id);
  }

  await rsvp(
    session.id,
    interaction.user.id,
    interaction.user.username,
    member?.displayName ?? interaction.user.username,
    status,
  );

  console.log('[attendance] DB work done, refreshing panel...');
  await refreshPanelMessage(session, interaction.client);
  console.log('[attendance] Handler complete');
}
