const path = require('path');
const dns = require('node:dns');
require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes
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


function isNodeVersionAtLeast(requiredMajor, requiredMinor, requiredPatch = 0) {
  const [major, minor, patch] = process.versions.node.split('.').map((value) => Number.parseInt(value, 10));

  if (major !== requiredMajor) {
    return major > requiredMajor;
  }

  if (minor !== requiredMinor) {
    return minor > requiredMinor;
  }

  return patch >= requiredPatch;
}

function enforceNodeVersion() {
  const required = '22.12.0';
  if (isNodeVersionAtLeast(22, 12, 0)) {
    return;
  }

  console.error(
    `Node.js ${required}+ is required for Discord voice DAVE support. Current runtime: ${process.versions.node}.`
  );
  console.error('Please upgrade Node.js, reinstall dependencies, and start the bot again.');
  process.exit(1);
}

function isEnvEnabled(value) {
  return typeof value === 'string' && /^(1|true|yes|on)$/i.test(value.trim());
}

function firstNonEmptyEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

enforceNodeVersion();

const DISCORD_TOKEN = normalizeDiscordToken(firstNonEmptyEnv('DISCORD_TOKEN', 'TOKEN'));
const DISCORD_CLIENT_ID = firstNonEmptyEnv('DISCORD_CLIENT_ID', 'APPLICATION_ID');
const DISCORD_GUILD_ID = firstNonEmptyEnv('DISCORD_GUILD_ID', 'DEV_GUILD');
const MUSIC_ROOT = process.env.MUSIC_ROOT || path.join(process.cwd(), 'music');
const DISCORD_DNS_RESULT_ORDER = process.env.DISCORD_DNS_RESULT_ORDER || 'ipv4first';

if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder(DISCORD_DNS_RESULT_ORDER);
  console.log(`DNS result order set to: ${DISCORD_DNS_RESULT_ORDER}`);
}

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) {
  console.error('Missing required env vars: DISCORD_TOKEN/TOKEN, DISCORD_CLIENT_ID/APPLICATION_ID, DISCORD_GUILD_ID/DEV_GUILD');
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
  {
    name: 'play',
    description: 'Play a full playlist',
    options: [
      {
        type: 3,
        name: 'playlist',
        description: 'Playlist (folder name)',
        required: true,
        choices: playlistChoices
      }
    ]
  },
  { name: 'skip', description: 'Skip the current song' },
  { name: 'shuffle', description: 'Shuffle the current queue' },
  { name: 'queue', description: 'Show the current queue' },
  {
    name: 'volume',
    description: 'Set playback volume',
    options: [
      {
        type: 4,
        name: 'level',
        description: 'Volume percentage (0-200)',
        required: true,
        min_value: 0,
        max_value: 200
      }
    ]
  },
  { name: 'leave', description: 'Leave the voice channel and clear the queue' },
  { name: 'help', description: 'List available commands' },
  { name: 'playlists', description: 'List all discovered playlists' }
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  const flushGlobalCommands = isEnvEnabled(process.env.DISCORD_FLUSH_GLOBAL_COMMANDS);
  const flushGuildCommands = isEnvEnabled(process.env.DISCORD_FLUSH_GUILD_COMMANDS);

  try {
    if (flushGuildCommands) {
      await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), {
        body: []
      });
      console.log('[Commands] Flushed existing guild commands.');
    }

    if (flushGlobalCommands) {
      await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), {
        body: []
      });
      console.log('[Commands] Flushed existing global commands.');
      console.log('[Commands] Global command deletion may take time to propagate in Discord clients.');
    }

    await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), {
      body: commandDefinitions
    });
    console.log('[Commands] Registered ' + commandDefinitions.length + ' guild command(s).');
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
    '- /play playlist:<name> - queue songs from your cached library in a new random order each time',
    '- /skip - skip current track',
    '- /shuffle - shuffle queued tracks',
    '- /queue - show the current queue (up to 10 tracks)',
    '- /volume level:<0-200> - set volume',
    '- /leave - disconnect and clear queue',
    '- /playlists - show playlist folders found on startup',
    '- /help - show this help'
  ].join('\n');
}

function formatQueueMessage(snapshot) {
  const hasNowPlaying = Boolean(snapshot.nowPlaying);
  const hasUpcoming = snapshot.upcoming.length > 0;

  if (!hasNowPlaying && !hasUpcoming) {
    return 'Queue is empty.';
  }

  const lines = ['Current queue (up to 10 tracks):'];
  let shown = 0;

  if (hasNowPlaying) {
    lines.push(`1. [Playing] **${snapshot.nowPlaying.name}**`);
    shown += 1;
  }

  if (hasUpcoming) {
    const nextNumber = hasNowPlaying ? 2 : 1;
    lines.push(`${nextNumber}. [Next] **${snapshot.upcoming[0].name}**`);
    shown += 1;

    const remaining = snapshot.upcoming.slice(1);
    const firstIndex = nextNumber + 1;
    remaining.forEach((track, idx) => {
      lines.push(`${firstIndex + idx}. ${track.name}`);
      shown += 1;
    });
  } else if (hasNowPlaying) {
    lines.push('No next track queued.');
  }

  if (snapshot.totalTracks > shown) {
    lines.push(`...and ${snapshot.totalTracks - shown} more in queue.`);
  }

  return lines.join('\n');
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

    if (interaction.commandName === 'queue') {
      const snapshot = player.getQueueSnapshot(10);
      await interaction.reply(formatQueueMessage(snapshot));
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
