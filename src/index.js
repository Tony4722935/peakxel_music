const path = require('path');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');
const { buildLibrary } = require('./library');
const { GuildMusicPlayer } = require('./player');

function cleanEnvValue(value) {
  if (!value) {
    return value;
  }

  return value.trim().replace(/\\n$/g, '');
}

function normalizeDiscordToken(rawToken) {
  const tokenValue = cleanEnvValue(rawToken);
  if (!tokenValue) {
    return tokenValue;
  }

  let token = tokenValue;

  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1).trim();
  }

  token = token.replace(/^Bot\s+/i, '').trim();
  return token;
}

const DISCORD_TOKEN = normalizeDiscordToken(process.env.DISCORD_TOKEN);
const DISCORD_CLIENT_ID = cleanEnvValue(process.env.DISCORD_CLIENT_ID);
const DISCORD_GUILD_ID = cleanEnvValue(process.env.DISCORD_GUILD_ID);
const MUSIC_ROOT =
  cleanEnvValue(process.env.MUSIC_LIBRARY_PATH) ||
  cleanEnvValue(process.env.MUSIC_ROOT) ||
  path.join(process.cwd(), 'music');

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) {
  console.error('Missing required env vars: DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID');
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
    .setDescription('Play a full playlist or a single track from a playlist')
    .addStringOption((option) => {
      const withChoices = option
        .setName('playlist')
        .setDescription('Playlist (folder name)')
        .setRequired(true);

      for (const choice of playlistChoices) {
        withChoices.addChoices(choice);
      }

      return withChoices;
    })
    .addStringOption((option) =>
      option
        .setName('track')
        .setDescription('Optional track name. If omitted, the full playlist is queued.')
        .setRequired(false)
    ),
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
  new SlashCommandBuilder().setName('functions').setDescription('Alias for /help'),
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
          'Check DISCORD_TOKEN in your .env; it must be the bot token only (no "Bot " prefix, no quotes).'
      );
    }

    throw error;
  }
}

function commandHelpText() {
  return [
    'Available slash commands:',
    '- /play playlist:<name> [track:<track name>] — queue songs from your cached library',
    '- /skip — skip current track',
    '- /shuffle — shuffle queued tracks',
    '- /volume level:<0-200> — set volume',
    '- /leave — disconnect and clear queue',
    '- /playlists — show playlist folders found on startup',
    '- /help or /functions — show this help'
  ].join('\n');
}

const guildPlayers = new Map();

function getGuildPlayer(guildId) {
  if (!guildPlayers.has(guildId)) {
    guildPlayers.set(guildId, new GuildMusicPlayer());
  }
  return guildPlayers.get(guildId);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

client.once('ready', () => {
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
        await interaction.reply({ content: 'Join a voice channel first.', ephemeral: true });
        return;
      }

      const playlistName = interaction.options.getString('playlist', true);
      const trackName = interaction.options.getString('track');
      const playlist = library.playlists[playlistName];

      if (!playlist || playlist.length === 0) {
        await interaction.reply({ content: `Playlist "${playlistName}" not found in cache. Restart the app after updating folders.`, ephemeral: true });
        return;
      }

      await player.connectToVoiceChannel(voiceChannel);

      if (trackName) {
        const chosenTrack = playlist.find((track) => track.name.toLowerCase() === trackName.toLowerCase());
        if (!chosenTrack) {
          await interaction.reply({
            content: `Track "${trackName}" not found in playlist "${playlistName}".`,
            ephemeral: true
          });
          return;
        }

        player.enqueueTracks([chosenTrack]);
        await interaction.reply(`Queued **${chosenTrack.name}** from **${playlistName}**.`);
        return;
      }

      player.enqueueTracks(playlist);
      await interaction.reply(`Queued ${playlist.length} tracks from **${playlistName}**.`);
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

    if (interaction.commandName === 'help' || interaction.commandName === 'functions') {
      await interaction.reply(commandHelpText());
      return;
    }

    await interaction.reply({ content: 'Unknown command.', ephemeral: true });
  } catch (error) {
    console.error('Command handling error:', error);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: 'An error occurred while handling your command.', ephemeral: true });
      return;
    }

    await interaction.reply({ content: 'An error occurred while handling your command.', ephemeral: true });
  }
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
