import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from 'discord.js';
import { getMusterPoints, addMusterPoint, removeMusterPoint } from '../services/musterService.js';
import { getRestaurantOptions, addRestaurantOption, removeRestaurantOption } from '../services/restaurantOptionService.js';
import { getActiveSessionForGuild, completeSession } from '../services/sessionService.js';
import { isAdmin, getMember } from '../utils/permissions.js';

export const data = new SlashCommandBuilder()
  .setName('munchassemble-config')
  .setDescription('Configure Munch Assemble settings for this server (admin or mod only)')
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
  )
  .addSubcommandGroup((group) =>
    group
      .setName('restaurant')
      .setDescription('Manage the restaurant pick list')
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Add a restaurant option to the pick list')
          .addStringOption((opt) =>
            opt.setName('name').setDescription('Name of the restaurant (e.g. "Chipotle")').setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Remove a restaurant option from the pick list')
          .addStringOption((opt) =>
            opt.setName('name').setDescription('Name of the restaurant to remove').setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub.setName('list').setDescription('List all configured restaurant options'),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAdmin(getMember(interaction))) {
    await interaction.reply({
      content: '❌ You need the **Mod** role or server admin permissions to use this command.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

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
  } else if (group === 'restaurant') {
    if (sub === 'list') {
      await handleRestaurantOptionList(interaction, guildId);
    } else if (sub === 'add') {
      await handleRestaurantOptionAdd(interaction, guildId);
    } else if (sub === 'remove') {
      await handleRestaurantOptionRemove(interaction, guildId);
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

async function handleRestaurantOptionList(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  const options = await getRestaurantOptions(guildId);
  if (options.length === 0) {
    await interaction.reply({
      content: '🍽️ No restaurant options configured. Use `/munchassemble-config restaurant add` to add some.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const list = options.map((r, i) => `${i + 1}. **${r.name}**`).join('\n');
  await interaction.reply({
    content: `🍽️ **Restaurant options for this server:**\n${list}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRestaurantOptionAdd(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  const name = interaction.options.getString('name', true).trim();

  if (!name || name.length > 80) {
    await interaction.reply({
      content: '❌ Restaurant name must be 1–80 characters.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await addRestaurantOption(guildId, name);
    await interaction.reply({
      content: `✅ **${name}** added to the restaurant pick list.`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    await interaction.reply({
      content: `❌ ${err instanceof Error ? err.message : 'Failed to add restaurant option.'}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleRestaurantOptionRemove(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<void> {
  const name = interaction.options.getString('name', true).trim();

  try {
    await removeRestaurantOption(guildId, name);
    await interaction.reply({
      content: `✅ **${name}** removed from the restaurant pick list.`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    await interaction.reply({
      content: `❌ ${err instanceof Error ? err.message : 'Failed to remove restaurant option.'}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
