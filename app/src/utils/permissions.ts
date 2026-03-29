import type { GuildMember, Interaction } from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';
import type { LunchSession } from '../types/index.js';

/**
 * Returns true if the interaction user is the session creator OR has
 * admin/mod permissions (Manage Guild or Administrator). (BR-003, §6)
 */
export function isCreatorOrAdmin(
  userId: string,
  member: GuildMember | null,
  session: LunchSession,
): boolean {
  if (userId === session.creatorId) return true;
  if (!member) return false;
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  );
}

/** Returns true if the interaction user has server admin or Manage Guild permission. */
export function isAdmin(member: GuildMember | null): boolean {
  if (!member) return false;
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  );
}

/** Helper to get GuildMember from an interaction (guards against DMs). */
export function getMember(interaction: Interaction): GuildMember | null {
  if (!interaction.inGuild()) return null;
  return interaction.member as GuildMember;
}
