import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  Interaction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  ChatInputCommandInteraction,
} from 'discord.js';
import { initConfig, getConfig } from './config.js';
import { expireOldSessions } from './services/sessionService.js';
import { execute as executeMunchAssemble, handleCreateSessionModal } from './commands/munchassemble.js';
import { handleAttendanceButton } from './interactions/attendanceHandler.js';
import {
  handleVoteButton,
  handleVoteSelect,
  handleAddSpotButton,
  handleAddSpotSelect,
  handleAddSpotModal,
  handleLockChoiceButton,
} from './interactions/restaurantHandler.js';
import { handleFinalizeButton, handlePingButton } from './interactions/adminHandler.js';
import { data as munchAssembleCommand } from './commands/munchassemble.js';

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error('[bot] Unhandled promise rejection:', msg);
});

async function registerCommands(appId: string, guildId: string, token: string): Promise<void> {
  const rest = new REST().setToken(token);
  try {
    await rest.put(Routes.applicationGuildCommands(appId, guildId), {
      body: [munchAssembleCommand.toJSON()],
    });
    console.log(`[bot] Commands registered for guild ${guildId}`);
  } catch (err) {
    console.error(`[bot] Failed to register commands for guild ${guildId}:`, err);
  }
}

async function main(): Promise<void> {
  await initConfig();
  const config = getConfig();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers, // needed for fetching member list (ping unanswered, BR-012)
    ],
  });

  client.once(Events.ClientReady, async (c) => {
    console.log(`[bot] Logged in as ${c.user.tag}`);

    // Expire stale sessions on startup (BR-005)
    try {
      await expireOldSessions();
      console.log('[bot] Stale sessions expired');
    } catch (err) {
      console.error('[bot] Failed to expire stale sessions:', err);
    }

    // Register commands
    if (config.discordGuildId) {
      await registerCommands(c.user.id, config.discordGuildId, config.discordBotToken);
    } else {
      for (const guild of c.guilds.cache.values()) {
        await registerCommands(c.user.id, guild.id, config.discordBotToken);
      }
    }
  });

  client.on(Events.GuildCreate, async (guild) => {
    const config = getConfig();
    await registerCommands(client.user!.id, guild.id, config.discordBotToken);
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      await routeInteraction(interaction);
    } catch (err) {
      console.error('[bot] Error handling interaction:', err);
    }
  });

  await client.login(config.discordBotToken);
}

async function routeInteraction(interaction: Interaction): Promise<void> {
  // ── Slash commands ──────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    const cmd = interaction as ChatInputCommandInteraction;
    if (cmd.commandName === 'munchassemble') {
      await executeMunchAssemble(cmd);
    }
    return;
  }

  // ── Modal submissions ───────────────────────────────────────────────────────
  if (interaction.isModalSubmit()) {
    const modal = interaction as ModalSubmitInteraction;
    if (modal.customId === 'modal:create_session') {
      await handleCreateSessionModal(modal);
    } else if (modal.customId.startsWith('modal:add_spot:')) {
      await handleAddSpotModal(modal);
    }
    return;
  }

  // ── Button interactions ─────────────────────────────────────────────────────
  if (interaction.isButton()) {
    const btn = interaction as ButtonInteraction;
    const [namespace, action] = btn.customId.split(':');

    if (namespace === 'rsvp') {
      await handleAttendanceButton(btn);
    } else if (namespace === 'restaurant') {
      if (action === 'vote') await handleVoteButton(btn);
      else if (action === 'add') await handleAddSpotButton(btn);
      else if (action === 'lock') await handleLockChoiceButton(btn);
    } else if (namespace === 'admin') {
      if (action === 'finalize') await handleFinalizeButton(btn);
      else if (action === 'ping') await handlePingButton(btn);
    }
    return;
  }

  // ── Select menus ────────────────────────────────────────────────────────────
  if (interaction.isStringSelectMenu()) {
    const select = interaction as StringSelectMenuInteraction;
    const [namespace, action] = select.customId.split(':');

    if (namespace === 'select' && action === 'vote') {
      await handleVoteSelect(select);
    } else if (namespace === 'restaurant' && action === 'add_select') {
      await handleAddSpotSelect(select);
    }
    return;
  }
}

main().catch((err) => {
  console.error('[bot] Fatal startup error:', err);
  process.exit(1);
});
