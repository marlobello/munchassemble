// ─── Enums ────────────────────────────────────────────────────────────────────

export enum SessionStatus {
  Planning = 'planning',
  Locked = 'locked',
  Completed = 'completed',
}

export enum AttendanceStatus {
  In = 'in',
  Maybe = 'maybe',
  Out = 'out',
}

/**
 * How the participant is getting to lunch.
 * Only valid when attendanceStatus === In.
 * Out or Maybe participants must have TransportStatus.None.
 */
export enum TransportStatus {
  None = 'none',
  DrivingAlone = 'driving_alone',
  CanDrive = 'can_drive',
  NeedRide = 'need_ride',
}

// ─── Core data types ──────────────────────────────────────────────────────────

/**
 * A single lunch coordination session.
 * One active session allowed per guild at a time (BR-001).
 */
export interface LunchSession {
  id: string;
  guildId: string;
  channelId: string;
  /** Discord message ID of the live session panel (BR-002). */
  messageId: string;
  creatorId: string;
  /** ISO date string, e.g. "2026-03-29" */
  date: string;
  /** "HH:MM" 24-hour format, e.g. "11:15" */
  lunchTime: string;
  /** "HH:MM" 24-hour format, e.g. "11:00" */
  departTime: string;
  notes?: string;
  status: SessionStatus;
  /** ID of the locked restaurant (set when creator locks choice, BR-023). */
  lockedRestaurantId?: string;
  createdAt: string;
  updatedAt: string;
  /** Cosmos DB TTL in seconds. Set to 2592000 (30 days) when session is completed/expired. */
  _ttl?: number;
}

/** RSVP + transport for one user within a session. */
export interface Participant {
  /** Composite: `${sessionId}::${userId}` */
  id: string;
  sessionId: string;
  userId: string;
  username: string;
  displayName: string;
  attendanceStatus: AttendanceStatus;
  /** How the participant is getting to lunch (only set when attendanceStatus === In). */
  transportStatus?: TransportStatus;
  /** userId of assigned driver (when transportStatus === NeedRide, BR-031). */
  assignedDriverId?: string;
  updatedAt: string;
}

/**
 * A restaurant option within a session.
 * votes is an array of userIds — one vote per user (BR-021).
 */
export interface Restaurant {
  /** Composite: `${sessionId}::${nanoid}` */
  id: string;
  sessionId: string;
  name: string;
  addedBy: string;
  votes: string[];
  createdAt: string;
}

/** Driver's carpool record within a session. */
export interface Carpool {
  /** Composite: `${sessionId}::${driverId}` */
  id: string;
  sessionId: string;
  driverId: string;
  seats: number;
  musterPoint: string;
  riders: string[];
  updatedAt: string;
}

/** A guild-level muster point configured by admins (BR-042). */
export interface MusterPointConfig {
  /** Composite: `${guildId}::${name}` */
  id: string;
  guildId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}

/** Frequently-used restaurant name persisted per guild (BR-024). */
export interface Favorite {
  /** Composite: `${guildId}::${name_normalized}` */
  id: string;
  guildId: string;
  name: string;
  usageCount: number;
  lastUsedAt: string;
}

// ─── Helper types ─────────────────────────────────────────────────────────────

/** Convenience view: session + its restaurants sorted by vote count. */
export interface SessionSummary {
  session: LunchSession;
  participants: Participant[];
  restaurants: Restaurant[];
  carpools: Carpool[];
}
