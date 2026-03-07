const path = require('path');
const dns = require('node:dns');
require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');
const { buildLibrary } = require('./library');
const { GuildMusicPlayer, shuffleArray } = require('./player');

function normalizeDiscordToken(rawToken) {
  if (!rawToken) {
    return rawToken;
  }

  let token = rawToken.trim();

  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1).trim();
  }

  token = token.replace(/^Bot\s+/i, '').trim();

  if (token.includes(' ')) {
    token = token.split(/\s+/)[0];
  }

  return token;
}

function decodeDiscordTokenId(token) {
  const [encodedId] = token.split('.');
  if (!encodedId) {
    return null;
  }

  try {
    return Buffer.from(encodedId, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

const DISCORD_TOKEN = normalizeDiscordToken(process.env.DISCORD_TOKEN);
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const MUSIC_ROOT = process.env.MUSIC_ROOT || path.join(process.cwd(), 'music');
const DISCORD_DNS_RESULT_ORDER = process.env.DISCORD_DNS_RESULT_ORDER || 'ipv4first';

if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder(DISCORD_DNS_RESULT_ORDER);
  console.log(`DNS result order set to: ${DISCORD_DNS_RESULT_ORDER}`);
}

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) {
  console.error('Missing required env vars: DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID');
  process.exit(1);
}

const tokenId = decodeDiscordTokenId(DISCORD_TOKEN);
if (tokenId && tokenId !== DISCORD_CLIENT_ID) {
  console.error(
    'DISCORD_TOKEN appears to belong to a different bot/application than DISCORD_CLIENT_ID. ' +
      'Use a token and client id from the same Discord app.'
  );
  process.exit(1);
}

let library;
try {
  library = buildLibrary(MUSIC_ROOT);
} catch (error) {
  console.error(`Failed to build music library from ${MUSIC_ROOT}:`, error.message);
  process.exit(1);
}

const playlistChoices = Object.keys(library.playlists).slice(0, 25).map((name) => ({ name, value: name }));

const commandDefinitions = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a full playlist')
    .addStringOption((option) => {
      const withChoices = option
        .setName('playlist')
        .setDescription('Playlist (folder name)')
        .setRequired(true);

      for (const choice of playlistChoices) {
        withChoices.addChoices(choice);
      }

      return withChoices;
    }),
  new SlashCommandBuilder().setName('skip').setDescription('Skip the current song'),
  new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle the current queue'),
  new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set playback volume')
    .addIntegerOption((option) =>
      option
        .setName('level')
        .setDescription('Volume percentage (0-200)')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(200)
    ),
  new SlashCommandBuilder().setName('leave').setDescription('Leave the voice channel and clear the queue'),
  new SlashCommandBuilder().setName('help').setDescription('List available commands'),
  new SlashCommandBuilder().setName('playlists').setDescription('List all discovered playlists')
].map((c) => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), {
      body: commandDefinitions
    });
  } catch (error) {
    if (error?.status === 401) {
      console.error(
        'Discord rejected the token while registering commands (401 Unauthorized). ' +
          'Check DISCORD_TOKEN in your .env; it must be the bot token only (no "Bot " prefix, no quotes), ' +
          'and ensure DISCORD_CLIENT_ID comes from the same Discord application.'
      );
    }

    throw error;
  }
}

function commandHelpText() {
  return [
    'Available slash commands:',
    '- /play playlist:<name> — queue songs from your cached library in a new random order each time',
    '- /skip — skip current track',
    '- /shuffle — shuffle queued tracks',
    '- /volume level:<0-200> — set volume',
    '- /leave — disconnect and clear queue',
    '- /playlists — show playlist folders found on startup',
    '- /help — show this help'
  ].join('\n');
}

const guildPlayers = new Map();

function getGuildPlayer(guildId) {
  if (!guildPlayers.has(guildId)) {
    guildPlayers.set(guildId, new GuildMusicPlayer());
  }
  return guildPlayers.get(guildId);
}

function isUnknownInteractionError(error) {
  return error?.code === 10062;
}

function isUnknownMessageError(error) {
  return error?.code === 10008;
}

function isAlreadyAcknowledgedError(error) {
  return error?.code === 40060;
}

function isVoiceConnectTimeoutError(error) {
  return error?.code === 'VOICE_CONNECT_TIMEOUT';
}

async function deferReplySafely(interaction) {
  if (interaction.deferred || interaction.replied) {
    return;
  }

  try {
    await interaction.deferReply();
  } catch (error) {
    if (isAlreadyAcknowledgedError(error) || isUnknownInteractionError(error)) {
      console.warn('Skipped deferReply because the interaction was already acknowledged.');
      return;
    }

    throw error;
  }
}

async function replySafely(interaction, payload) {
  try {
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply(payload);
      return;
    }

    if (interaction.replied) {
      await interaction.followUp(payload);
      return;
    }

    await interaction.reply(payload);
  } catch (error) {
    if (isUnknownInteractionError(error) || isUnknownMessageError(error) || isAlreadyAcknowledgedError(error)) {
      console.warn('Skipped interaction response because the interaction response message is no longer available.');
      return;
    }

    throw error;
  }
}

function ephemeralMessage(content) {
  return {
    content,
    flags: MessageFlags.Ephemeral
  };
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Music library loaded from ${library.musicRoot} at ${library.generatedAt}`);
  console.log(`Discovered playlists: ${Object.keys(library.playlists).join(', ') || '(none)'}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {
    const player = getGuildPlayer(interaction.guildId);

    if (interaction.commandName === 'play') {
      const voiceChannel = interaction.member.voice.channel;
      if (!voiceChannel) {
        await replySafely(interaction, ephemeralMessage('Join a voice channel first.'));
        return;
      }

      const playlistName = interaction.options.getString('playlist', true);
      const playlist = library.playlists[playlistName];

      if (!playlist || playlist.length === 0) {
        await replySafely(
          interaction,
          ephemeralMessage(`Playlist "${playlistName}" not found in cache. Restart the app after updating folders.`)
        );
        return;
      }

      if (!interaction.deferred && !interaction.replied) {
        await deferReplySafely(interaction);
      }

      await player.connectToVoiceChannel(voiceChannel);

      const shuffledPlaylist = shuffleArray(playlist);
      player.enqueueTracks(shuffledPlaylist);
      await replySafely(interaction, `Queued ${playlist.length} tracks from **${playlistName}** in shuffled order.`);
      return;
    }

    if (interaction.commandName === 'skip') {
      player.skip();
      await interaction.reply('Skipped current track.');
      return;
    }

    if (interaction.commandName === 'shuffle') {
      player.shuffleQueue();
      await interaction.reply('Shuffled the queue.');
      return;
    }

    if (interaction.commandName === 'volume') {
      const level = interaction.options.getInteger('level', true);
      const actual = player.setVolume(level);
      await interaction.reply(`Volume set to ${actual}%.`);
      return;
    }

    if (interaction.commandName === 'leave') {
      player.leave();
      await interaction.reply('Left the voice channel and cleared queue.');
      return;
    }

    if (interaction.commandName === 'playlists') {
      const entries = Object.entries(library.playlists);
      if (entries.length === 0) {
        await interaction.reply('No playlists found in cache.');
        return;
      }

      const lines = entries
        .map(([name, tracks]) => `- ${name} (${tracks.length} tracks)`)
        .join('\n');

      await interaction.reply(`Cached playlists:\n${lines}`);
      return;
    }

    if (interaction.commandName === 'help') {
      await interaction.reply(commandHelpText());
      return;
    }

    await replySafely(interaction, ephemeralMessage('Unknown command.'));
  } catch (error) {
    if (isVoiceConnectTimeoutError(error)) {
      console.warn('Voice connection timed out before becoming ready.');
      await replySafely(interaction, ephemeralMessage('Could not connect to the voice channel in time. Please try again.'));
      return;
    }

    console.error('Command handling error:', error);
    await replySafely(interaction, ephemeralMessage('An error occurred while handling your command.'));
  }
});

client.on('error', (error) => {
  console.error('Discord client error:', error);
});

(async () => {
  try {
    await registerCommands();
    await client.login(DISCORD_TOKEN);
  } catch (error) {
    console.error('Startup failed:', error);
    process.exit(1);
  }
})();
