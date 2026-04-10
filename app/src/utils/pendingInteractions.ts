import type { ButtonInteraction } from 'discord.js';

/**
 * In-memory store for ButtonInteractions that must be carried through a
 * multi-step flow (ephemeral select → modal → panel update).
 *
 * Storing the original panel ButtonInteraction lets subsequent steps call
 * storedInteraction.editReply(panel), which uses the proven interaction webhook
 * endpoint instead of the REST channel/messages endpoint. This is the same
 * mechanism used by all single-step panel buttons and always works for
 * Components V2 messages.
 *
 * Token lifetime: Discord interaction tokens are valid for 15 minutes.
 * Entries in this store expire after 14 minutes to stay within that window.
 * Single-instance deployment (minReplicas: 1) makes in-memory storage safe.
 */

const TTL_MS = 14 * 60 * 1000;

interface PendingEntry {
  interaction: ButtonInteraction;
  /** Set once the user picks a known muster point (Can Drive flow). */
  musterPoint?: string;
  expiresAt: number;
}

const store = new Map<string, PendingEntry>();

/** Store a panel ButtonInteraction keyed by a namespaced flow key. */
export function storePendingInteraction(key: string, interaction: ButtonInteraction): void {
  store.set(key, { interaction, expiresAt: Date.now() + TTL_MS });
}

/**
 * Attach a muster point to an existing pending entry.
 * Called when the user selects a known muster point before the seats modal.
 */
export function setPendingMusterPoint(key: string, musterPoint: string): void {
  const entry = store.get(key);
  if (entry) {
    entry.musterPoint = musterPoint;
  }
}

/**
 * Retrieve and remove a pending entry.
 * Returns null if the entry does not exist or has expired.
 */
export function takePendingInteraction(key: string): PendingEntry | null {
  const entry = store.get(key);
  store.delete(key);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry;
}
