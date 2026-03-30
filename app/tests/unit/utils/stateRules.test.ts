import { AttendanceStatus, TransportStatus } from '../../../src/types';
import type { Participant } from '../../../src/types';
import {
  canVote,
  canHostCarpool,
  canRequestTransport,
  transportBlockedReason,
  voteBlockedReason,
} from '../../../src/utils/stateRules';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeParticipant(
  overrides: Partial<Participant> = {},
): Participant {
  return {
    id: 'sess::user',
    sessionId: 'sess',
    userId: 'user',
    username: 'testuser',
    displayName: 'Test User',
    attendanceStatus: AttendanceStatus.In,
    transportStatus: TransportStatus.None,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── canVote ───────────────────────────────────────────────────────────────────

describe('canVote', () => {
  it('returns true for null (unregistered user)', () => {
    expect(canVote(null)).toBe(true);
  });
  it('returns true for In', () => {
    expect(canVote(makeParticipant({ attendanceStatus: AttendanceStatus.In }))).toBe(true);
  });
  it('returns true for Maybe', () => {
    expect(canVote(makeParticipant({ attendanceStatus: AttendanceStatus.Maybe }))).toBe(true);
  });
  it('returns false for Out', () => {
    expect(canVote(makeParticipant({ attendanceStatus: AttendanceStatus.Out }))).toBe(false);
  });
});

// ── canHostCarpool ────────────────────────────────────────────────────────────

describe('canHostCarpool', () => {
  it('returns true for null (unregistered — will auto-promote to In)', () => {
    expect(canHostCarpool(null)).toBe(true);
  });
  it('returns true for In', () => {
    expect(canHostCarpool(makeParticipant({ attendanceStatus: AttendanceStatus.In }))).toBe(true);
  });
  it('returns false for Maybe', () => {
    expect(canHostCarpool(makeParticipant({ attendanceStatus: AttendanceStatus.Maybe }))).toBe(false);
  });
  it('returns false for Out', () => {
    expect(canHostCarpool(makeParticipant({ attendanceStatus: AttendanceStatus.Out }))).toBe(false);
  });
});

// ── canRequestTransport ───────────────────────────────────────────────────────

describe('canRequestTransport', () => {
  it('returns true for null (unregistered)', () => {
    expect(canRequestTransport(null)).toBe(true);
  });
  it('returns true for In', () => {
    expect(canRequestTransport(makeParticipant({ attendanceStatus: AttendanceStatus.In }))).toBe(true);
  });
  it('returns true for Maybe (DrivingAlone and NeedRide are allowed)', () => {
    expect(canRequestTransport(makeParticipant({ attendanceStatus: AttendanceStatus.Maybe }))).toBe(true);
  });
  it('returns false for Out', () => {
    expect(canRequestTransport(makeParticipant({ attendanceStatus: AttendanceStatus.Out }))).toBe(false);
  });
});

// ── transportBlockedReason ────────────────────────────────────────────────────

describe('transportBlockedReason', () => {
  it('returns null for null participant (unregistered)', () => {
    expect(transportBlockedReason(null, TransportStatus.DrivingAlone)).toBeNull();
  });

  it('returns null for In + any transport', () => {
    const p = makeParticipant({ attendanceStatus: AttendanceStatus.In });
    expect(transportBlockedReason(p, TransportStatus.DrivingAlone)).toBeNull();
    expect(transportBlockedReason(p, TransportStatus.CanDrive)).toBeNull();
    expect(transportBlockedReason(p, TransportStatus.NeedRide)).toBeNull();
  });

  it('returns error for Out + any transport', () => {
    const p = makeParticipant({ attendanceStatus: AttendanceStatus.Out });
    expect(transportBlockedReason(p, TransportStatus.DrivingAlone)).toMatch(/Out/);
    expect(transportBlockedReason(p, TransportStatus.CanDrive)).toMatch(/Out/);
    expect(transportBlockedReason(p, TransportStatus.NeedRide)).toMatch(/Out/);
  });

  it('returns error for Maybe + CanDrive', () => {
    const p = makeParticipant({ attendanceStatus: AttendanceStatus.Maybe });
    expect(transportBlockedReason(p, TransportStatus.CanDrive)).toMatch(/In/);
  });

  it('returns null for Maybe + DrivingAlone (allowed)', () => {
    const p = makeParticipant({ attendanceStatus: AttendanceStatus.Maybe });
    expect(transportBlockedReason(p, TransportStatus.DrivingAlone)).toBeNull();
  });

  it('returns null for Maybe + NeedRide (allowed)', () => {
    const p = makeParticipant({ attendanceStatus: AttendanceStatus.Maybe });
    expect(transportBlockedReason(p, TransportStatus.NeedRide)).toBeNull();
  });
});

// ── voteBlockedReason ─────────────────────────────────────────────────────────

describe('voteBlockedReason', () => {
  it('returns null for null participant', () => {
    expect(voteBlockedReason(null)).toBeNull();
  });
  it('returns null for In', () => {
    expect(voteBlockedReason(makeParticipant({ attendanceStatus: AttendanceStatus.In }))).toBeNull();
  });
  it('returns null for Maybe', () => {
    expect(voteBlockedReason(makeParticipant({ attendanceStatus: AttendanceStatus.Maybe }))).toBeNull();
  });
  it('returns error string for Out', () => {
    const p = makeParticipant({ attendanceStatus: AttendanceStatus.Out });
    expect(voteBlockedReason(p)).toMatch(/Out/);
  });
});
