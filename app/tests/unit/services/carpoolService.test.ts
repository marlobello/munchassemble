// Mock Cosmos repos before importing the service
jest.mock('../../../src/db/repositories/participantRepo', () => ({
  getParticipant: jest.fn(),
  upsertParticipant: jest.fn(async (p) => p),
  getParticipantsForSession: jest.fn(async () => []),
}));

jest.mock('../../../src/db/repositories/carpoolRepo', () => ({
  getCarpoolByDriver: jest.fn(),
  getCarpoolsForSession: jest.fn(async () => []),
  upsertCarpool: jest.fn(async (c) => c),
  deleteCarpool: jest.fn(async () => undefined),
}));

import { AttendanceStatus, TransportStatus } from '../../../src/types';
import type { Participant, Carpool } from '../../../src/types';
import {
  assignRiderToDriver,
  registerDriver,
  requestRide,
  clearCarpoolRole,
} from '../../../src/services/carpoolService';
import * as participantRepo from '../../../src/db/repositories/participantRepo';
import * as carpoolRepo from '../../../src/db/repositories/carpoolRepo';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeParticipant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'sess::user',
    sessionId: 'sess',
    userId: 'user-a',
    username: 'usera',
    displayName: 'User A',
    attendanceStatus: AttendanceStatus.In,
    transportStatus: TransportStatus.None,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeCarpool(overrides: Partial<Carpool> = {}): Carpool {
  return {
    id: 'sess::driver-1',
    sessionId: 'sess',
    driverId: 'driver-1',
    seats: 3,
    musterPoint: 'Garage A',
    riders: [],
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

// ── assignRiderToDriver ───────────────────────────────────────────────────────

describe('assignRiderToDriver', () => {
  it('throws when rider === driver (self-join guard)', async () => {
    await expect(
      assignRiderToDriver('sess', 'driver-1', 'driver-1', 'u', 'U'),
    ).rejects.toThrow(/own carpool/);
  });

  it('throws when carpool does not exist', async () => {
    (carpoolRepo.getCarpoolByDriver as jest.Mock).mockResolvedValue(null);
    await expect(
      assignRiderToDriver('sess', 'rider-1', 'driver-1', 'u', 'U'),
    ).rejects.toThrow(/not found/);
  });

  it('throws when carpool is full (initial read)', async () => {
    (carpoolRepo.getCarpoolByDriver as jest.Mock).mockResolvedValue(
      makeCarpool({ seats: 1, riders: ['someone-else'] }),
    );
    (participantRepo.getParticipant as jest.Mock).mockResolvedValue(
      makeParticipant({ userId: 'rider-1' }),
    );
    await expect(
      assignRiderToDriver('sess', 'rider-1', 'driver-1', 'u', 'U'),
    ).rejects.toThrow(/No seats/);
  });

  it('throws when Out user tries to join', async () => {
    (carpoolRepo.getCarpoolByDriver as jest.Mock).mockResolvedValue(makeCarpool());
    (participantRepo.getParticipant as jest.Mock).mockResolvedValue(
      makeParticipant({ userId: 'rider-1', attendanceStatus: AttendanceStatus.Out }),
    );
    await expect(
      assignRiderToDriver('sess', 'rider-1', 'driver-1', 'u', 'U'),
    ).rejects.toThrow(/In.*Maybe/);
  });

  it('successfully assigns a rider and adds to carpool.riders', async () => {
    const carpool = makeCarpool({ seats: 3, riders: [] });
    (carpoolRepo.getCarpoolByDriver as jest.Mock).mockImplementation(
      async (_s: string, id: string) => (id === 'driver-1' ? carpool : null),
    );
    (participantRepo.getParticipant as jest.Mock).mockResolvedValue(
      makeParticipant({ userId: 'rider-1', attendanceStatus: AttendanceStatus.In }),
    );

    await assignRiderToDriver('sess', 'rider-1', 'driver-1', 'rider1', 'Rider 1');

    expect(carpoolRepo.upsertCarpool).toHaveBeenCalledWith(
      expect.objectContaining({ riders: expect.arrayContaining(['rider-1']) }),
    );
    expect(participantRepo.upsertParticipant).toHaveBeenCalledWith(
      expect.objectContaining({ assignedDriverId: 'driver-1', transportStatus: TransportStatus.NeedRide }),
    );
  });

  it('prevents overbooking: throws when fresh read shows full carpool', async () => {
    // First call returns 1 seat open; subsequent calls for driver-1 show it full
    let callCount = 0;
    (carpoolRepo.getCarpoolByDriver as jest.Mock).mockImplementation(
      async (_s: string, id: string) => {
        if (id !== 'driver-1') return null;
        callCount++;
        // First call (initial check): 1 seat open. Third call (fresh read): now full.
        return callCount === 1
          ? makeCarpool({ seats: 2, riders: ['someone'] })
          : makeCarpool({ seats: 2, riders: ['someone', 'race-winner'] });
      },
    );
    (participantRepo.getParticipant as jest.Mock).mockResolvedValue(
      makeParticipant({ userId: 'rider-1', attendanceStatus: AttendanceStatus.In }),
    );

    await expect(
      assignRiderToDriver('sess', 'rider-1', 'driver-1', 'u', 'U'),
    ).rejects.toThrow(/just filled up/);
  });

  it('rolls back carpool if participant upsert fails', async () => {
    const carpool = makeCarpool({ seats: 3, riders: [] });
    (carpoolRepo.getCarpoolByDriver as jest.Mock).mockImplementation(
      async (_s: string, id: string) => (id === 'driver-1' ? carpool : null),
    );
    (participantRepo.getParticipant as jest.Mock).mockResolvedValue(
      makeParticipant({ userId: 'rider-1', attendanceStatus: AttendanceStatus.In }),
    );
    (participantRepo.upsertParticipant as jest.Mock).mockRejectedValueOnce(new Error('DB error'));

    await expect(
      assignRiderToDriver('sess', 'rider-1', 'driver-1', 'u', 'U'),
    ).rejects.toThrow('DB error');

    // Rollback: upsertCarpool should be called again with rider-1 removed
    const calls = (carpoolRepo.upsertCarpool as jest.Mock).mock.calls;
    const rollbackCall = calls[calls.length - 1][0] as Carpool;
    expect(rollbackCall.riders).not.toContain('rider-1');
  });

  it('does not double-add rider already in the carpool', async () => {
    const carpool = makeCarpool({ seats: 3, riders: ['rider-1'] });
    (carpoolRepo.getCarpoolByDriver as jest.Mock).mockImplementation(
      async (_s: string, id: string) => (id === 'driver-1' ? carpool : null),
    );
    (participantRepo.getParticipant as jest.Mock).mockResolvedValue(
      makeParticipant({ userId: 'rider-1', assignedDriverId: 'driver-1', attendanceStatus: AttendanceStatus.In }),
    );

    await assignRiderToDriver('sess', 'rider-1', 'driver-1', 'u', 'U');

    // upsertCarpool should NOT be called since rider already in list
    expect(carpoolRepo.upsertCarpool).not.toHaveBeenCalled();
  });
});

// ── registerDriver ────────────────────────────────────────────────────────────

describe('registerDriver', () => {
  it('throws when user is Out', async () => {
    (participantRepo.getParticipant as jest.Mock).mockResolvedValue(
      makeParticipant({ attendanceStatus: AttendanceStatus.Out }),
    );
    await expect(registerDriver('sess', 'user-a', 3, 'Garage A', 'u', 'U')).rejects.toThrow(/In/);
  });

  it('throws when user is Maybe', async () => {
    (participantRepo.getParticipant as jest.Mock).mockResolvedValue(
      makeParticipant({ attendanceStatus: AttendanceStatus.Maybe }),
    );
    await expect(registerDriver('sess', 'user-a', 3, 'Garage A', 'u', 'U')).rejects.toThrow(/In/);
  });

  it('registers driver and creates carpool for In user', async () => {
    (participantRepo.getParticipant as jest.Mock).mockResolvedValue(
      makeParticipant({ attendanceStatus: AttendanceStatus.In }),
    );
    (carpoolRepo.getCarpoolByDriver as jest.Mock).mockResolvedValue(null);

    const result = await registerDriver('sess', 'user-a', 3, 'Garage A', 'u', 'U');

    expect(result.driverId).toBe('user-a');
    expect(result.seats).toBe(3);
    expect(result.musterPoint).toBe('Garage A');
    expect(carpoolRepo.upsertCarpool).toHaveBeenCalled();
    expect(participantRepo.upsertParticipant).toHaveBeenCalledWith(
      expect.objectContaining({ transportStatus: TransportStatus.CanDrive }),
    );
  });

  it('creates an In participant for a brand-new (unset) driver — no orphan carpool', async () => {
    (participantRepo.getParticipant as jest.Mock).mockResolvedValue(null);
    (carpoolRepo.getCarpoolByDriver as jest.Mock).mockResolvedValue(null);

    await registerDriver('sess', 'new-user', 3, 'Garage A', 'newuser', 'New User');

    // A participant record must be created so the driver shows as In with CanDrive transport
    expect(participantRepo.upsertParticipant).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'new-user',
        username: 'newuser',
        displayName: 'New User',
        attendanceStatus: AttendanceStatus.In,
        transportStatus: TransportStatus.CanDrive,
      }),
    );
  });

  it('rolls back carpool if participant upsert fails for a new driver', async () => {
    (participantRepo.getParticipant as jest.Mock).mockResolvedValue(null);
    (carpoolRepo.getCarpoolByDriver as jest.Mock).mockResolvedValue(null);
    (participantRepo.upsertParticipant as jest.Mock).mockRejectedValueOnce(new Error('DB error'));

    await expect(
      registerDriver('sess', 'new-user', 3, 'Garage A', 'newuser', 'New User'),
    ).rejects.toThrow('DB error');

    expect(carpoolRepo.deleteCarpool).toHaveBeenCalledWith('sess', 'new-user');
  });

  it('rejects a seat reduction below the current rider count (no overbooking)', async () => {
    (participantRepo.getParticipant as jest.Mock).mockResolvedValue(
      makeParticipant({ userId: 'driver-1', attendanceStatus: AttendanceStatus.In }),
    );
    (carpoolRepo.getCarpoolByDriver as jest.Mock).mockResolvedValue(
      makeCarpool({ driverId: 'driver-1', seats: 3, riders: ['r1', 'r2', 'r3'] }),
    );

    await expect(
      registerDriver('sess', 'driver-1', 1, 'Garage A', 'u', 'U'),
    ).rejects.toThrow(/3.*rider|rider.*3/i);

    // Rejection must have no side effects — carpool untouched.
    expect(carpoolRepo.upsertCarpool).not.toHaveBeenCalled();
    expect(participantRepo.upsertParticipant).not.toHaveBeenCalled();
  });

  it('allows re-registering with seats equal to the current rider count', async () => {
    (participantRepo.getParticipant as jest.Mock).mockResolvedValue(
      makeParticipant({ userId: 'driver-1', attendanceStatus: AttendanceStatus.In }),
    );
    (carpoolRepo.getCarpoolByDriver as jest.Mock).mockResolvedValue(
      makeCarpool({ driverId: 'driver-1', seats: 3, riders: ['r1', 'r2'] }),
    );

    const result = await registerDriver('sess', 'driver-1', 2, 'Garage A', 'u', 'U');

    expect(result.seats).toBe(2);
    expect(result.riders).toEqual(['r1', 'r2']);
    expect(carpoolRepo.upsertCarpool).toHaveBeenCalled();
  });
});

// ── requestRide ───────────────────────────────────────────────────────────────

describe('requestRide', () => {
  it('throws when user is Out', async () => {
    (participantRepo.getParticipant as jest.Mock).mockResolvedValue(
      makeParticipant({ attendanceStatus: AttendanceStatus.Out }),
    );
    (carpoolRepo.getCarpoolByDriver as jest.Mock).mockResolvedValue(null);
    await expect(requestRide('sess', 'user-a', 'u', 'U')).rejects.toThrow(/In.*Maybe/);
  });

  it('marks NeedRide for Maybe user without auto-promoting to In', async () => {
    (participantRepo.getParticipant as jest.Mock).mockResolvedValue(
      makeParticipant({ attendanceStatus: AttendanceStatus.Maybe }),
    );
    (carpoolRepo.getCarpoolByDriver as jest.Mock).mockResolvedValue(null);

    await requestRide('sess', 'user-a', 'u', 'U');

    expect(participantRepo.upsertParticipant).toHaveBeenCalledWith(
      expect.objectContaining({
        transportStatus: TransportStatus.NeedRide,
        attendanceStatus: AttendanceStatus.Maybe, // stays Maybe
      }),
    );
  });
});

// ── clearCarpoolRole ──────────────────────────────────────────────────────────

describe('clearCarpoolRole', () => {
  it('removes a rider from their assigned driver\'s carpool (issue #10)', async () => {
    const carpool = makeCarpool({ driverId: 'driver-1', seats: 3, riders: ['rider-1', 'other'] });
    (participantRepo.getParticipant as jest.Mock).mockResolvedValue(
      makeParticipant({
        userId: 'rider-1',
        attendanceStatus: AttendanceStatus.In,
        transportStatus: TransportStatus.NeedRide,
        assignedDriverId: 'driver-1',
      }),
    );
    (carpoolRepo.getCarpoolByDriver as jest.Mock).mockResolvedValue(carpool);

    await clearCarpoolRole('sess', 'rider-1');

    // Seat freed: rider-1 removed from the driver's carpool, others preserved.
    expect(carpoolRepo.upsertCarpool).toHaveBeenCalledWith(
      expect.objectContaining({ driverId: 'driver-1', riders: ['other'] }),
    );
    // Participant's transport + assignment cleared.
    expect(participantRepo.upsertParticipant).toHaveBeenCalledWith(
      expect.objectContaining({
        transportStatus: TransportStatus.None,
        assignedDriverId: undefined,
      }),
    );
  });

  it('unregisters a driver (cascades to their riders) when clearing a CanDrive role', async () => {
    (participantRepo.getParticipant as jest.Mock).mockResolvedValue(
      makeParticipant({ userId: 'driver-1', transportStatus: TransportStatus.CanDrive }),
    );
    // unregisterDriver path: driver has an empty carpool, then clears own transport.
    (carpoolRepo.getCarpoolByDriver as jest.Mock).mockResolvedValue(
      makeCarpool({ driverId: 'driver-1', riders: [] }),
    );

    await clearCarpoolRole('sess', 'driver-1');

    expect(carpoolRepo.deleteCarpool).toHaveBeenCalledWith('sess', 'driver-1');
  });

  it('does not touch any carpool when the user had no assigned driver', async () => {
    (participantRepo.getParticipant as jest.Mock).mockResolvedValue(
      makeParticipant({
        userId: 'user-a',
        transportStatus: TransportStatus.NeedRide,
        assignedDriverId: undefined,
      }),
    );

    await clearCarpoolRole('sess', 'user-a');

    expect(carpoolRepo.upsertCarpool).not.toHaveBeenCalled();
    expect(participantRepo.upsertParticipant).toHaveBeenCalledWith(
      expect.objectContaining({ transportStatus: TransportStatus.None, assignedDriverId: undefined }),
    );
  });

  it('no-ops when the participant does not exist', async () => {
    (participantRepo.getParticipant as jest.Mock).mockResolvedValue(null);

    await clearCarpoolRole('sess', 'ghost');

    expect(participantRepo.upsertParticipant).not.toHaveBeenCalled();
    expect(carpoolRepo.upsertCarpool).not.toHaveBeenCalled();
  });
});
