import type { Participant } from '../types/index.js';
import { AttendanceStatus, TransportStatus } from '../types/index.js';

/** The three derived transport groups shown in the panel and channel notifications. */
export interface TransportGroups {
  /** Participants driving themselves (TransportStatus.DrivingAlone). */
  soloDrivers: Participant[];
  /** NeedRide participants not yet assigned to a driver. */
  unassignedRiders: Participant[];
  /** In/Maybe participants who haven't declared any transport yet. */
  undeclared: Participant[];
}

/**
 * Single source of truth for categorizing transport status, shared by the panel
 * builder, notification builder, and status command so they never drift apart.
 */
export function categorizeTransport(participants: Participant[]): TransportGroups {
  return {
    soloDrivers: participants.filter((p) => p.transportStatus === TransportStatus.DrivingAlone),
    unassignedRiders: participants.filter(
      (p) => p.transportStatus === TransportStatus.NeedRide && !p.assignedDriverId,
    ),
    undeclared: participants.filter(
      (p) =>
        (p.attendanceStatus === AttendanceStatus.In ||
          p.attendanceStatus === AttendanceStatus.Maybe) &&
        p.transportStatus === TransportStatus.None,
    ),
  };
}
