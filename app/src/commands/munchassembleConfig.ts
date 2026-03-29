import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { getMusterPoints, addMusterPoint, removeMusterPoint } from '../services/musterService.js';
import { getActiveSessionForGuild, completeSession } from '../services/sessionService.js';

export const data = new SlashCommandBuilder()
  .setName('munchassemble-config')
  .setDescription('Configure Munch Assemble settings for this server (admin only)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommandGroup((group) =>
    group
      .setName('session')
      .setDescription('Manage the active session')
      .addSubcommand((sub) =>
        sub
          .setName('cancel')
          .setDescription('Cancel (close) the current active session so a new one can be created'),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName('musterpoint')
      .setDescription('Manage muster/meeting points')
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Add a muster point')
          .addStringOption((opt) =>
            opt.setName('name').setDescription('Name of the muster point (e.g. "Garage A")').setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Remove a muster point')
          .addStringOption((opt) =>
            opt.setName('name').setDescription('Name of the muster point to remove').setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub.setName('list').setDescription('List all configured muster points'),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId!;
  const group = interaction.options.getSubcommandGroup();
  const sub = interaction.options.getSubcommand();

  if (group === 'session') {
    if (sub === 'cancel') {
      await handleSessionCancel(interaction, guildId);
    }
  } else if (group === 'musterpoint') {
    if (sub === 'list') {
      await handleMusterList(interaction, guildId);
    } else if (sub === 'add') {
      await handleMusterAdd(interaction, guildId);
    } else if (sub === 'remove') {
      await handleMusterRemove(interaction, guildId);
    }
  }
}

async function handleMusterList(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  const points = await getMusterPoints(guildId);
  if (points.length === 0) {
    await interaction.reply({
      content: '📍 No muster points configured for this server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const list = points.map((mp, i) => `${i + 1}. **${mp.name}**`).join('\n');
  await interaction.reply({
    content: `📍 **Muster Points for this server:**\n${list}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleMusterAdd(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  const name = interaction.options.getString('name', true).trim();

  if (!name || name.length > 50) {
    await interaction.reply({
      content: '❌ Muster point name must be 1–50 characters.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await addMusterPoint(guildId, name);
    await interaction.reply({
      content: `✅ Muster point **${name}** added.`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    await interaction.reply({
      content: `❌ ${err instanceof Error ? err.message : 'Failed to add muster point.'}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleMusterRemove(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  const name = interaction.options.getString('name', true).trim();

  try {
    await removeMusterPoint(guildId, name);
    await interaction.reply({
      content: `✅ Muster point **${name}** removed.`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    await interaction.reply({
      content: `❌ ${err instanceof Error ? err.message : 'Failed to remove muster point.'}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleSessionCancel(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  const session = await getActiveSessionForGuild(guildId);
  if (!session) {
    await interaction.reply({
      content: '⚠️ No active session to cancel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await completeSession(session);
  await interaction.reply({
    content: `✅ Session for **${session.date}** has been cancelled. You can now create a new one.`,
    flags: MessageFlags.Ephemeral,
  });
}
