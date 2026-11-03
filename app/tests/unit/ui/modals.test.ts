jest.mock('../../../src/services/sessionService', () => ({
  getActiveSessionForGuild: jest.fn(async () => null),
  getLocalToday: jest.fn(() => '2026-11-03'),
}));
jest.mock('../../../src/utils/interactionHelpers', () => ({
  requireActiveSession: jest.fn(async () => ({
    lunchTime: '11:45',
    departTime: '11:30',
  })),
}));
jest.mock('../../../src/utils/permissions', () => ({
  isCreatorOrAdmin: jest.fn(() => true),
  getMember: jest.fn(),
}));
jest.mock('../../../src/utils/pendingInteractions', () => ({
  setPendingMusterPoint: jest.fn(),
}));

import {
  ComponentType,
  ModalBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { execute } from '../../../src/commands/munchassemble';
import { handleEditTimeButton } from '../../../src/interactions/adminHandler';
import { handleDrivingMusterSelect } from '../../../src/interactions/carpoolHandler';
import { setPendingMusterPoint } from '../../../src/utils/pendingInteractions';

function expectInputs(modal: ModalBuilder, fields: { custom_id: string; value?: string; required: boolean }[]): void {
  expect(modal.toJSON().components).toEqual(fields.map((field) => expect.objectContaining({
    type: ComponentType.Label,
    label: expect.any(String),
    component: expect.objectContaining({ type: ComponentType.TextInput, ...field }),
  })));
}

describe('label-based Discord modals', () => {
  it('preserves session creation field IDs, defaults, and optional notes', async () => {
    const showModal = jest.fn();
    await execute({
      guildId: 'guild',
      options: { getSubcommandGroup: () => null, getSubcommand: () => 'create' },
      showModal,
    } as unknown as ChatInputCommandInteraction);

    expectInputs(showModal.mock.calls[0][0], [
      { custom_id: 'date', value: '2026-11-03', required: true },
      { custom_id: 'lunchTime', value: '11:15', required: true },
      { custom_id: 'departTime', value: '11:00', required: true },
      { custom_id: 'notes', required: false },
    ]);
  });

  it('preserves existing session times in the edit modal', async () => {
    const showModal = jest.fn();
    await handleEditTimeButton({
      customId: 'admin:edit_time:session',
      user: { id: 'creator' },
      showModal,
    } as unknown as ButtonInteraction);

    expectInputs(showModal.mock.calls[0][0], [
      { custom_id: 'lunchTime', value: '11:45', required: true },
      { custom_id: 'departTime', value: '11:30', required: true },
    ]);
  });

  it('preserves the driver seat field and selected muster point', async () => {
    const showModal = jest.fn();
    await handleDrivingMusterSelect({
      customId: 'carpool:driving_muster:session',
      values: ['mp::Garage A'],
      user: { id: 'driver' },
      showModal,
    } as unknown as StringSelectMenuInteraction);

    expectInputs(showModal.mock.calls[0][0], [
      { custom_id: 'seats', value: '3', required: true },
    ]);
    expect(setPendingMusterPoint).toHaveBeenCalledWith('driving:session:driver', 'Garage A');
  });
});
