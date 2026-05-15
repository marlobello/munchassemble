import type { LunchSession, Participant, Restaurant, Carpool } from '../types/index.js';
import { AttendanceStatus, TransportStatus } from '../types/index.js';
import { format12h } from '../ui/panelBuilder.js';

/**
 * Build a notification summary suitable for channel messages (Finalize, T-15, T-5).
 * All three notifications share the same transportation/attendance detail level.
 */
export function buildNotificationSummary(
  session: LunchSession,
  participants: Participant[],
  restaurants: Restaurant[],
  carpools: Carpool[],
  header: string,
): string {
  const restaurant = session.lockedRestaurantId
    ? restaurants.find((r) => r.id === session.lockedRestaurantId)
    : restaurants.sort((a, b) => b.votes.length - a.votes.length)[0];

  const inList = participants.filter((p) => p.attendanceStatus === AttendanceStatus.In);

  const lines: string[] = [
    header,
    `🍔 **Restaurant:** ${restaurant?.name ?? 'TBD'}`,
    `⏰ **Depart:** ${format12h(session.departTime)} | **Lunch:** ${format12h(session.lunchTime)}`,
    `👥 **Going (${inList.length}):** ${inList.map((p) => p.displayName).join(', ') || 'TBD'}`,
  ];

  // Transportation details
  const soloDrivers = participants.filter((p) => p.transportStatus === TransportStatus.DrivingAlone);
  const unassignedRiders = participants.filter(
    (p) => p.transportStatus === TransportStatus.NeedRide && !p.assignedDriverId,
  );
  const undeclared = participants.filter(
    (p) =>
      (p.attendanceStatus === AttendanceStatus.In || p.attendanceStatus === AttendanceStatus.Maybe) &&
      p.transportStatus === TransportStatus.None,
  );

  if (carpools.length > 0 || soloDrivers.length > 0 || unassignedRiders.length > 0 || undeclared.length > 0) {
    lines.push('', '🚗 **Transportation**');

    for (const carpool of carpools) {
      const driverName =
        participants.find((p) => p.userId === carpool.driverId)?.displayName ?? `<@${carpool.driverId}>`;
      const riderNames = carpool.riders
        .map((rid) => participants.find((p) => p.userId === rid)?.displayName ?? `<@${rid}>`)
        .join(', ');
      const seatsFree = carpool.seats - carpool.riders.length;
      const seatsLabel = seatsFree > 0 ? `${seatsFree} seat${seatsFree !== 1 ? 's' : ''} open` : 'full';
      const riderPart = carpool.riders.length > 0 ? ` → ${riderNames}` : ' → no riders yet';
      lines.push(`  🚗 **${driverName}** (${carpool.musterPoint}, ${seatsLabel})${riderPart}`);
    }

    if (soloDrivers.length > 0) {
      lines.push(`  🚘 **Driving alone:** ${soloDrivers.map((p) => p.displayName).join(', ')}`);
    }

    if (unassignedRiders.length > 0) {
      lines.push(`  🚌 **Still need a ride:** ${unassignedRiders.map((p) => p.displayName).join(', ')}`);
    }

    if (undeclared.length > 0) {
      lines.push(`  ❓ **Undeclared:** ${undeclared.map((p) => p.displayName).join(', ')}`);
    }
  }

  return lines.join('\n');
}
