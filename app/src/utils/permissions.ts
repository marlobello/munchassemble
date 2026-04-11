import type { GuildMember, Interaction } from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';
import type { LunchSession } from '../types/index.js';

/** Returns true if the member holds a guild role named "mod" (case-insensitive). */
function hasMod(member: GuildMember): boolean {
  const modRole = member.guild.roles.cache.find((r) => r.name.toLowerCase() === 'mod');
  return !!modRole && member.roles.cache.has(modRole.id);
}

/**
 * Returns true if the interaction user is the session creator OR has
 * admin/mod permissions (Administrator, Manage Guild, or Mod role). (BR-003, §6)
 */
export function isCreatorOrAdmin(
  userId: string,
  member: GuildMember | null,
  session: LunchSession,
): boolean {
  if (userId === session.creatorId) return true;
  if (!member) return false;
  return isAdmin(member);
}

/** Returns true if the member has Administrator, Manage Guild, or the "mod" guild role. */
export function isAdmin(member: GuildMember | null): boolean {
  if (!member) return false;
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    hasMod(member)
  );
}

/** Helper to get GuildMember from an interaction (guards against DMs). */
export function getMember(interaction: Interaction): GuildMember | null {
  if (!interaction.inGuild()) return null;
  return interaction.member as GuildMember;
}
