const {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  generateDependencyReport,
  getVoiceConnection,
  joinVoiceChannel
} = require('@discordjs/voice');
const ffmpegStatic = require('ffmpeg-static');
const prism = require('prism-media');

if (ffmpegStatic) {
  process.env.FFMPEG_PATH = ffmpegStatic;
}

const VOICE_READY_TIMEOUT_MS = 20_000;
const VOICE_CONNECT_MAX_ATTEMPTS = 5;
const VOICE_RECONNECT_GRACE_MS = 5_000;

function ensureFfmpegAvailable() {
  try {
    const probe = new prism.FFmpeg({
      args: ['-version']
    });

    probe.destroy();
  } catch (error) {
    throw new Error(
      'FFmpeg is required for playback but was not found. Install ffmpeg in the runtime environment (Docker image should include it).'
    );
  }
}


function ensureVoiceEncryptionDependency() {
  const encryptionPackages = [
    'tweetnacl',
    'libsodium-wrappers',
    'sodium',
    'sodium-native',
    '@noble/ciphers',
    '@stablelib/xchacha20poly1305'
  ];
  const hasInstalledEncryptionLibrary = encryptionPackages.some((packageName) => {
    try {
      require.resolve(packageName);
      return true;
    } catch {
      return false;
    }
  });

  const report = generateDependencyReport();
  const hasEncryptionLibrary =
    hasInstalledEncryptionLibrary ||
    /(@stablelib\/xchacha20poly1305|@noble\/ciphers|sodium-native|sodium|libsodium-wrappers|tweetnacl)\b/i.test(report);

  if (!hasEncryptionLibrary) {
    throw new Error(
      'Discord voice encryption dependency missing. Install one of: tweetnacl, libsodium-wrappers, sodium, sodium-native, @noble/ciphers, @stablelib/xchacha20poly1305.'
    );
  }

  console.log(`[Voice] Dependency report:
${report}`);
}

function createTrackResource(track, volume = 1) {
  const transcoder = new prism.FFmpeg({
    args: [
      '-hide_banner',
      '-loglevel',
      'panic',
      '-i',
      track.filePath,
      '-analyzeduration',
      '0',
      '-af',
      `volume=${volume}`,
      '-f',
      'opus',
      '-ar',
      '48000',
      '-ac',
      '2'
    ]
  });

  return createAudioResource(transcoder, {
    inputType: StreamType.Opus,
    metadata: track
  });
}

function shuffleArray(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class GuildMusicPlayer {
  constructor() {
    ensureFfmpegAvailable();
    ensureVoiceEncryptionDependency();

    this.player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause
      }
    });

    this.queue = [];
    this.current = null;
    this.volume = 1;
    this.connection = null;
    this.connectionListenerCleanup = null;
    this.lastVoiceChannel = null;

    this.player.on(AudioPlayerStatus.Idle, () => {
      console.log('[Player] Audio player became idle, advancing queue.');
      this.playNext();
    });

    this.player.on('error', (error) => {
      console.error('Audio player error:', error);
      this.playNext();
    });
  }

  async connectToVoiceChannel(voiceChannel) {
    const guildId = voiceChannel.guild.id;
    this.lastVoiceChannel = voiceChannel;
    console.log(
      `[Voice][${guildId}] connect requested: channel=${voiceChannel.id} name="${voiceChannel.name}" bitrate=${voiceChannel.bitrate}`
    );

    const existing = getVoiceConnection(guildId);

    if (existing) {
      const shouldRejoin = existing.joinConfig.channelId !== voiceChannel.id;
      if (shouldRejoin) {
        existing.rejoin({
          channelId: voiceChannel.id,
          selfDeaf: true,
          selfMute: false
        });
        console.log(`[Voice][${guildId}] rejoin requested for channel=${voiceChannel.id}`);
      }

      this.connection = existing;
      console.log(
        `[Voice][${guildId}] reusing existing connection status=${existing.state.status} targetChannel=${existing.joinConfig.channelId}`
      );
    } else {
      this.connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: false
      });
      console.log(`[Voice][${guildId}] created new connection status=${this.connection.state.status}`);
    }

    this.attachConnectionListeners(guildId);

    try {
      await this.waitUntilReady(voiceChannel.id);
      this.connection.subscribe(this.player);
      console.log(`[Voice][${guildId}] connection ready and audio player subscribed.`);
    } catch (error) {
      console.error(`[Voice][${guildId}] failed to connect in time:`, error);

      const connectionToDestroy = this.connection || getVoiceConnection(guildId);
      if (connectionToDestroy) {
        connectionToDestroy.destroy();
      }
      this.connection = null;

      const wrappedError = new Error('Timed out while connecting to the voice channel.');
      wrappedError.code = 'VOICE_CONNECT_TIMEOUT';
      wrappedError.cause = error;
      throw wrappedError;
    }
  }

  async waitUntilReady(channelId) {
    const guildId = this.connection?.joinConfig?.guildId || 'unknown';
    let lastError = null;

    for (let attempt = 1; attempt <= VOICE_CONNECT_MAX_ATTEMPTS; attempt += 1) {
      console.log(
        `[Voice][${guildId}] waitUntilReady attempt ${attempt}/${VOICE_CONNECT_MAX_ATTEMPTS} (status=${this.connection?.state?.status || 'missing'})`
      );
      try {
        if (!this.connection) {
          throw new Error('Voice connection was not established.');
        }

        if (this.connection.state.status !== VoiceConnectionStatus.Ready) {
          await entersState(this.connection, VoiceConnectionStatus.Ready, VOICE_READY_TIMEOUT_MS);
        }

        console.log(`[Voice][${guildId}] reached Ready state.`);
        return;
      } catch (error) {
        lastError = error;
        console.warn(`[Voice][${guildId}] ready wait failed on attempt ${attempt}:`, error?.message || error);

        if (attempt === VOICE_CONNECT_MAX_ATTEMPTS) {
          break;
        }

        if (!this.connection) {
          break;
        }

        const status = this.connection.state.status;

        if (status === VoiceConnectionStatus.Signalling && this.lastVoiceChannel) {
          console.warn(
            `[Voice][${guildId}] connection stuck in signalling; recreating voice connection for channel=${channelId}`
          );

          this.detachConnectionListeners();
          this.connection.destroy();
          this.connection = joinVoiceChannel({
            channelId: this.lastVoiceChannel.id,
            guildId: this.lastVoiceChannel.guild.id,
            adapterCreator: this.lastVoiceChannel.guild.voiceAdapterCreator,
            selfDeaf: true,
            selfMute: false
          });
          this.attachConnectionListeners(guildId);

          console.log(`[Voice][${guildId}] created replacement connection status=${this.connection.state.status}`);
          continue;
        }

        this.connection.rejoin({
          channelId,
          selfDeaf: true,
          selfMute: false
        });
        console.log(`[Voice][${guildId}] rejoin requested for channel=${channelId}`);
      }
    }

    console.error(`[Voice][${guildId}] exhausted all connection attempts.`);
    throw lastError;
  }

  enqueueTracks(tracks) {
    this.queue.push(...tracks);
    console.log(`[Player] Enqueued ${tracks.length} track(s). Queue length is now ${this.queue.length}.`);

    if (!this.current) {
      this.playNext();
    }
  }

  playNext() {
    const next = this.queue.shift();
    this.current = next || null;

    if (!next) {
      console.log('[Player] Queue empty, nothing to play.');
      return;
    }

    console.log(`[Player] Starting track: ${next.name} (${next.filePath})`);

    let resource;
    try {
      resource = createTrackResource(next, this.volume);
    } catch (error) {
      console.error(`Failed to create audio resource for track ${next.name}:`, error);
      this.playNext();
      return;
    }

    this.player.play(resource);
    console.log('[Player] Audio resource submitted to Discord audio player.');
  }

  skip() {
    console.log('[Player] Skip requested.');
    this.player.stop();
  }

  shuffleQueue() {
    this.queue = shuffleArray(this.queue);
    console.log('[Player] Queue shuffled.');
  }

  setVolume(percent) {
    this.volume = Math.max(0, Math.min(percent, 200)) / 100;

    const rounded = Math.round(this.volume * 100);
    console.log(`[Player] Volume updated to ${rounded}%.`);
    return rounded;
  }

  leave() {
    if (this.connection) {
      this.detachConnectionListeners();
      this.connection.destroy();
      this.connection = null;
    }

    console.log('[Player] Leaving voice channel and clearing queue.');
    this.player.stop();
    this.queue = [];
    this.current = null;
  }
}

GuildMusicPlayer.prototype.attachConnectionListeners = function attachConnectionListeners(guildId) {
  if (!this.connection) {
    return;
  }

  this.detachConnectionListeners();

  const connection = this.connection;

  const onStateChange = async (oldState, newState) => {
    console.log(`[Voice][${guildId}] connection state: ${oldState.status} -> ${newState.status}`);

    if (newState.status !== VoiceConnectionStatus.Disconnected) {
      return;
    }

    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, VOICE_RECONNECT_GRACE_MS),
        entersState(connection, VoiceConnectionStatus.Connecting, VOICE_RECONNECT_GRACE_MS)
      ]);

      console.log(`[Voice][${guildId}] disconnected briefly; waiting for reconnect sequence.`);
    } catch {
      console.warn(`[Voice][${guildId}] disconnected without recovery; destroying voice connection.`);
      this.detachConnectionListeners();
      connection.destroy();

      if (this.connection === connection) {
        this.connection = null;
      }
    }
  };

  connection.on('stateChange', onStateChange);

  this.connectionListenerCleanup = () => {
    connection.off('stateChange', onStateChange);
  };
};

GuildMusicPlayer.prototype.detachConnectionListeners = function detachConnectionListeners() {
  if (this.connectionListenerCleanup) {
    this.connectionListenerCleanup();
    this.connectionListenerCleanup = null;
  }
};

module.exports = {
  GuildMusicPlayer,
  shuffleArray
};
