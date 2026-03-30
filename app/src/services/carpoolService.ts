import type { Carpool, Participant } from '../types/index.js';
import { AttendanceStatus, TransportStatus } from '../types/index.js';
import {
  upsertCarpool,
  getCarpoolByDriver,
  getCarpoolsForSession,
  deleteCarpool,
} from '../db/repositories/carpoolRepo.js';
import {
  getParticipant,
  upsertParticipant,
  getParticipantsForSession,
} from '../db/repositories/participantRepo.js';
import { canHostCarpool, canRequestTransport } from '../utils/stateRules.js';

/**
 * Register the user as a driver for the session.
 * Requires attendanceStatus === In (or no record — new record auto-promotes to In).
 * Throws if the user is Out or Maybe.
 */
export async function registerDriver(
  sessionId: string,
  driverId: string,
  seats: number,
  musterPoint: string,
): Promise<Carpool> {
  const now = new Date().toISOString();

  // Validate state: only In (or unset) can host a carpool
  const p = await getParticipant(sessionId, driverId);
  if (!canHostCarpool(p)) {
    if (p?.attendanceStatus === AttendanceStatus.Maybe) {
      throw new Error("You need to confirm you're **In** before hosting a carpool.");
    }
    throw new Error("You need to be **In** to host a carpool.");
  }

  // If user was previously a rider in someone else's carpool, remove them from it
  if (p?.assignedDriverId) {
    const prevCarpool = await getCarpoolByDriver(sessionId, p.assignedDriverId);
    if (prevCarpool) {
      prevCarpool.riders = prevCarpool.riders.filter((id) => id !== driverId);
      prevCarpool.updatedAt = now;
      await upsertCarpool(prevCarpool);
    }
  }

  const existing = await getCarpoolByDriver(sessionId, driverId);
  const carpool: Carpool = {
    id: `${sessionId}::${driverId}`,
    sessionId,
    driverId,
    seats,
    musterPoint,
    riders: existing?.riders ?? [],
    updatedAt: now,
  };
  await upsertCarpool(carpool);

  // Update participant transport status — no auto-promote; attendance stays as-is for existing In participants
  const autoPromote = !p?.attendanceStatus;
  if (p) {
    await upsertParticipant({
      ...p,
      transportStatus: TransportStatus.CanDrive,
      attendanceStatus: autoPromote ? AttendanceStatus.In : p.attendanceStatus,
      assignedDriverId: undefined,
      updatedAt: now,
    });
  }

  return carpool;
}

/** Remove the user as a driver; unassign all their riders (back to NeedRide). */
export async function unregisterDriver(sessionId: string, driverId: string): Promise<void> {
  const carpool = await getCarpoolByDriver(sessionId, driverId);
  if (carpool) {
    // Unassign all riders — they still need a ride
    await Promise.all(
      carpool.riders.map(async (riderId) => {
        const p = await getParticipant(sessionId, riderId);
        if (p) {
          await upsertParticipant({
            ...p,
            transportStatus: TransportStatus.NeedRide,
            assignedDriverId: undefined,
            updatedAt: new Date().toISOString(),
          });
        }
      }),
    );
    await deleteCarpool(sessionId, driverId);
  }

  // Clear driver's transport status
  const driverParticipant = await getParticipant(sessionId, driverId);
  if (driverParticipant) {
    await upsertParticipant({
      ...driverParticipant,
      transportStatus: TransportStatus.None,
      updatedAt: new Date().toISOString(),
    });
  }
}

/**
 * Mark the user as needing a ride.
 * Requires attendanceStatus !== Out. Maybe is allowed (attendance stays Maybe).
 * Auto-promotes to In only for brand-new (unset) participants.
 */
export async function requestRide(
  sessionId: string,
  userId: string,
  username: string,
  displayName: string,
): Promise<Participant> {
  const now = new Date().toISOString();
  const existing = await getParticipant(sessionId, userId);

  // Validate: Out users cannot request a ride
  if (!canRequestTransport(existing)) {
    throw new Error("You need to be **In** (or **Maybe**) to request a ride.");
  }

  // If previously a driver, unregister them first
  const prevCarpoolAsDriver = await getCarpoolByDriver(sessionId, userId);
  if (prevCarpoolAsDriver) {
    await unregisterDriver(sessionId, userId);
  }

  // Auto-promote only if no attendance record yet; Maybe stays Maybe
  const autoPromote = !existing?.attendanceStatus;

  const participant: Participant = existing
    ? {
        ...existing,
        transportStatus: TransportStatus.NeedRide,
        attendanceStatus: autoPromote ? AttendanceStatus.In : existing.attendanceStatus,
        assignedDriverId: undefined,
        updatedAt: now,
      }
    : {
        id: `${sessionId}::${userId}`,
        sessionId,
        userId,
        username,
        displayName,
        attendanceStatus: AttendanceStatus.In,
        transportStatus: TransportStatus.NeedRide,
        updatedAt: now,
      };
  return upsertParticipant(participant);
}

/** Clear a user's transport status (they'll show as "no transport set"). */
export async function clearCarpoolRole(sessionId: string, userId: string): Promise<void> {
  const p = await getParticipant(sessionId, userId);
  if (!p) return;

  if (p.transportStatus === TransportStatus.CanDrive) {
    await unregisterDriver(sessionId, userId);
  } else {
    await upsertParticipant({
      ...p,
      transportStatus: TransportStatus.None,
      assignedDriverId: undefined,
      updatedAt: new Date().toISOString(),
    });
  }
}

/**
 * Clear ONLY a CanDrive role, leaving DrivingAlone and NeedRide intact.
 * Used when attendance changes to Maybe: CanDrive is prohibited but other transport is allowed.
 */
export async function clearCanDriveRoleOnly(sessionId: string, userId: string): Promise<void> {
  const p = await getParticipant(sessionId, userId);
  if (!p) return;
  if (p.transportStatus === TransportStatus.CanDrive) {
    await unregisterDriver(sessionId, userId);
  }
  // DrivingAlone and NeedRide are intentionally preserved
}

/**
 * Auto-assign riders to available drivers (BR-036).
 * Returns the updated carpools.
 */
export async function autoAssignRides(sessionId: string): Promise<Carpool[]> {
  const carpools = await getCarpoolsForSession(sessionId);
  const participants = await getParticipantsForSession(sessionId);

  // Unassigned NeedRide participants
  const riders = participants.filter(
    (p) => p.transportStatus === TransportStatus.NeedRide && !p.assignedDriverId,
  );

  const now = new Date().toISOString();

  for (const carpool of carpools) {
    const available = carpool.seats - carpool.riders.length;
    if (available <= 0) continue;

    const toAssign = riders.filter((r) => !r.assignedDriverId).slice(0, available);

    for (const rider of toAssign) {
      rider.assignedDriverId = carpool.driverId;
      rider.transportStatus = TransportStatus.NeedRide;
      rider.updatedAt = now;
      carpool.riders.push(rider.userId);
      await upsertParticipant(rider);
    }
    if (toAssign.length > 0) {
      carpool.updatedAt = now;
      await upsertCarpool(carpool);
    }
  }

  return getCarpoolsForSession(sessionId);
}

export { getCarpoolsForSession };

/**
 * Directly assigns a rider to a specific driver's carpool.
 * Removes the rider from any previous carpool, unregisters them as a driver if applicable.
 * Throws if the driver's carpool doesn't exist or has no available seats.
 */
export async function assignRiderToDriver(
  sessionId: string,
  riderId: string,
  driverId: string,
  username: string,
  displayName: string,
): Promise<void> {
  if (riderId === driverId) throw new Error('You cannot join your own carpool.');

  const carpool = await getCarpoolByDriver(sessionId, driverId);
  if (!carpool) throw new Error('Driver not found or has not registered.');

  const available = carpool.seats - carpool.riders.length;
  if (available <= 0) throw new Error('No seats available with that driver.');

  // Validate: Out users cannot join a carpool
  const existing = await getParticipant(sessionId, riderId);
  if (!canRequestTransport(existing)) {
    throw new Error("You need to be **In** (or **Maybe**) to join a carpool.");
  }

  // If the rider was previously a driver, unregister them
  const prevCarpoolAsDriver = await getCarpoolByDriver(sessionId, riderId);
  if (prevCarpoolAsDriver) {
    await unregisterDriver(sessionId, riderId);
  }

  // Remove rider from any previous driver's carpool
  if (existing?.assignedDriverId && existing.assignedDriverId !== driverId) {
    const prevCarpool = await getCarpoolByDriver(sessionId, existing.assignedDriverId);
    if (prevCarpool) {
      prevCarpool.riders = prevCarpool.riders.filter((id) => id !== riderId);
      prevCarpool.updatedAt = new Date().toISOString();
      await upsertCarpool(prevCarpool);
    }
  }

  // Don't double-add if already in this carpool
  if (!carpool.riders.includes(riderId)) {
    carpool.riders.push(riderId);
    carpool.updatedAt = new Date().toISOString();
    await upsertCarpool(carpool);
  }

  const now = new Date().toISOString();
  // Auto-promote only for fully unset; Maybe attendance stays Maybe
  const autoPromote = !existing?.attendanceStatus;
  const participant: Participant = existing
    ? {
        ...existing,
        transportStatus: TransportStatus.NeedRide,
        attendanceStatus: autoPromote ? AttendanceStatus.In : existing.attendanceStatus,
        assignedDriverId: driverId,
        updatedAt: now,
      }
    : {
        id: `${sessionId}::${riderId}`,
        sessionId,
        userId: riderId,
        username,
        displayName,
        attendanceStatus: AttendanceStatus.In,
        transportStatus: TransportStatus.NeedRide,
        assignedDriverId: driverId,
        updatedAt: now,
      };
  await upsertParticipant(participant);
}
