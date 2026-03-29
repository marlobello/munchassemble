import type { Carpool, Participant } from '../types/index.js';
import { ParticipantRole } from '../types/index.js';
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

/** Register the user as a driver for the session. */
export async function registerDriver(
  sessionId: string,
  driverId: string,
  seats: number,
  musterPoint: string,
): Promise<Carpool> {
  const now = new Date().toISOString();
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
  return upsertCarpool(carpool);
}

/** Remove the user as a driver; unassign all their riders. */
export async function unregisterDriver(sessionId: string, driverId: string): Promise<void> {
  const carpool = await getCarpoolByDriver(sessionId, driverId);
  if (carpool) {
    // Unassign all riders
    await Promise.all(
      carpool.riders.map(async (riderId) => {
        const p = await getParticipant(sessionId, riderId);
        if (p) {
          await upsertParticipant({ ...p, role: ParticipantRole.None, assignedDriverId: undefined });
        }
      }),
    );
    await deleteCarpool(sessionId, driverId);
  }

  // Update the driver's own participant record
  const driverParticipant = await getParticipant(sessionId, driverId);
  if (driverParticipant) {
    await upsertParticipant({ ...driverParticipant, role: ParticipantRole.None });
  }
}

/** Mark the user as needing a ride. */
export async function requestRide(
  sessionId: string,
  userId: string,
  username: string,
  displayName: string,
): Promise<Participant> {
  const now = new Date().toISOString();
  const existing = await getParticipant(sessionId, userId);
  const participant: Participant = existing
    ? { ...existing, role: ParticipantRole.Rider, assignedDriverId: undefined, updatedAt: now }
    : {
        id: `${sessionId}::${userId}`,
        sessionId,
        userId,
        username,
        displayName,
        attendanceStatus: 'in' as Participant['attendanceStatus'],
        role: ParticipantRole.Rider,
        updatedAt: now,
      };
  return upsertParticipant(participant);
}

/** Remove carpool role from a user (switch back to "unset"). */
export async function clearCarpoolRole(sessionId: string, userId: string): Promise<void> {
  const p = await getParticipant(sessionId, userId);
  if (!p) return;

  if (p.role === ParticipantRole.Driver) {
    await unregisterDriver(sessionId, userId);
  } else {
    await upsertParticipant({ ...p, role: ParticipantRole.None, assignedDriverId: undefined, updatedAt: new Date().toISOString() });
  }
}

/**
 * Auto-assign riders to available drivers by muster point grouping (BR-036).
 * Riders with a matching muster point fill the driver's car first.
 * Returns the updated carpools.
 */
export async function autoAssignRides(sessionId: string): Promise<Carpool[]> {
  const carpools = await getCarpoolsForSession(sessionId);
  const participants = await getParticipantsForSession(sessionId);

  const riders = participants.filter(
    (p) => p.role === ParticipantRole.Rider && !p.assignedDriverId,
  );

  const now = new Date().toISOString();

  // Assign riders greedily: same muster point first, then any
  for (const carpool of carpools) {
    const available = carpool.seats - carpool.riders.length;
    if (available <= 0) continue;

    // Prefer riders at the same muster point
    const samePoint = riders.filter(
      (r) => !r.assignedDriverId && r.musterPoint === carpool.musterPoint,
    );
    const others = riders.filter(
      (r) => !r.assignedDriverId && r.musterPoint !== carpool.musterPoint,
    );
    const toAssign = [...samePoint, ...others].slice(0, available);

    for (const rider of toAssign) {
      rider.assignedDriverId = carpool.driverId;
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
