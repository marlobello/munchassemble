import { AttendanceStatus, TransportStatus } from '../types/index.js';
import type { Participant } from '../types/index.js';

/**
 * State machine rules for attendance × transport × vote.
 *
 * Agreed matrix (2026-03-30):
 *
 * | Attendance | Vote | DrivingAlone | CanDrive | NeedRide |
 * |------------|------|--------------|----------|----------|
 * | In         |  ✅  |      ✅      |    ✅    |    ✅    |
 * | Maybe      |  ✅  |  ✅ (stays Maybe) |  ❌  |  ✅ (stays Maybe) |
 * | Out        |  ❌  |      ❌      |    ❌    |    ❌    |
 * | Unset      |  ✅  |  ✅ → auto-promote In | ✅ → auto-promote In | ✅ → auto-promote In |
 *
 * Cascade rules on attendance change:
 * → Out:   clear ALL transport (cancel CanDrive carpool, remove from NeedRide carpool) + remove vote
 * → Maybe: clear CanDrive ONLY (cancel hosted carpool + unassign riders); keep DrivingAlone/NeedRide; keep vote
 * → In:    no cascade
 */

/** Returns true if this participant is allowed to cast or change their restaurant vote. */
export function canVote(participant: Participant | null): boolean {
  if (!participant) return true; // unregistered users may vote
  return participant.attendanceStatus !== AttendanceStatus.Out;
}

/** Returns true if this participant is allowed to set ANY transport status. */
export function canSetTransport(participant: Participant | null): boolean {
  if (!participant) return true; // unregistered → will be auto-promoted to In
  return participant.attendanceStatus === AttendanceStatus.In ||
         participant.attendanceStatus === AttendanceStatus.Maybe;
}

/**
 * Returns true if this participant is allowed to host a carpool (CanDrive).
 * Requires In attendance — Maybe users may not commit to driving.
 */
export function canHostCarpool(participant: Participant | null): boolean {
  if (!participant) return true; // unregistered → will be auto-promoted to In
  return participant.attendanceStatus === AttendanceStatus.In;
}

/** Returns true if this participant is allowed to request a ride (NeedRide or DrivingAlone). */
export function canRequestTransport(participant: Participant | null): boolean {
  return canSetTransport(participant);
}

/** Friendly error message when a transport action is blocked. */
export function transportBlockedReason(
  participant: Participant | null,
  transport: TransportStatus,
): string | null {
  if (!participant) return null; // allowed

  if (participant.attendanceStatus === AttendanceStatus.Out) {
    return "❌ You're marked as **Out** — set your attendance to **In** or **Maybe** first.";
  }

  if (
    participant.attendanceStatus === AttendanceStatus.Maybe &&
    transport === TransportStatus.CanDrive
  ) {
    return "❌ You need to confirm you're **In** before hosting a carpool.";
  }

  return null; // allowed
}

/** Friendly error message when voting is blocked. */
export function voteBlockedReason(participant: Participant | null): string | null {
  if (participant?.attendanceStatus === AttendanceStatus.Out) {
    return "❌ You're marked as **Out** and cannot vote on a restaurant.";
  }
  return null; // allowed
}
