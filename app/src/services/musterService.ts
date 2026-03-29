import type { MusterPointConfig } from '../types/index.js';
import {
  getMusterPointsForGuild,
  upsertMusterPoint,
  deleteMusterPoint,
  seedDefaultMusterPoints,
} from '../db/repositories/musterRepo.js';

/** Return active muster points for the guild, seeding defaults if none exist. */
export async function getMusterPoints(guildId: string): Promise<MusterPointConfig[]> {
  await seedDefaultMusterPoints(guildId);
  return getMusterPointsForGuild(guildId);
}

/** Add a new muster point. Returns the created entry. */
export async function addMusterPoint(guildId: string, name: string): Promise<MusterPointConfig> {
  const trimmed = name.trim();
  const mp: MusterPointConfig = {
    id: `${guildId}::${trimmed.toLowerCase()}`,
    guildId,
    name: trimmed,
    isActive: true,
    createdAt: new Date().toISOString(),
  };
  return upsertMusterPoint(mp);
}

/** Remove a muster point by name. */
export async function removeMusterPoint(guildId: string, name: string): Promise<void> {
  return deleteMusterPoint(guildId, name);
}

export { seedDefaultMusterPoints };
