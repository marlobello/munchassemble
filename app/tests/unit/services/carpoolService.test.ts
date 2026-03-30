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
    await expect(registerDriver('sess', 'user-a', 3, 'Garage A')).rejects.toThrow(/In/);
  });

  it('throws when user is Maybe', async () => {
    (participantRepo.getParticipant as jest.Mock).mockResolvedValue(
      makeParticipant({ attendanceStatus: AttendanceStatus.Maybe }),
    );
    await expect(registerDriver('sess', 'user-a', 3, 'Garage A')).rejects.toThrow(/In/);
  });

  it('registers driver and creates carpool for In user', async () => {
    (participantRepo.getParticipant as jest.Mock).mockResolvedValue(
      makeParticipant({ attendanceStatus: AttendanceStatus.In }),
    );
    (carpoolRepo.getCarpoolByDriver as jest.Mock).mockResolvedValue(null);

    const result = await registerDriver('sess', 'user-a', 3, 'Garage A');

    expect(result.driverId).toBe('user-a');
    expect(result.seats).toBe(3);
    expect(result.musterPoint).toBe('Garage A');
    expect(carpoolRepo.upsertCarpool).toHaveBeenCalled();
    expect(participantRepo.upsertParticipant).toHaveBeenCalledWith(
      expect.objectContaining({ transportStatus: TransportStatus.CanDrive }),
    );
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
