const {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel
} = require('@discordjs/voice');
const prism = require('prism-media');

const VOICE_READY_TIMEOUT_MS = 60_000;
const VOICE_CONNECT_MAX_ATTEMPTS = 3;

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

    this.player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause
      }
    });

    this.queue = [];
    this.current = null;
    this.volume = 1;
    this.connection = null;

    this.player.on(AudioPlayerStatus.Idle, () => {
      this.playNext();
    });

    this.player.on('error', (error) => {
      console.error('Audio player error:', error);
      this.playNext();
    });
  }

  async connectToVoiceChannel(voiceChannel) {
    const guildId = voiceChannel.guild.id;
    const existing = getVoiceConnection(guildId);

    if (existing) {
      const shouldRejoin = existing.joinConfig.channelId !== voiceChannel.id;
      if (shouldRejoin) {
        existing.rejoin({
          channelId: voiceChannel.id,
          selfDeaf: true
        });
      }

      this.connection = existing;
    } else {
      this.connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: true
      });
    }

    try {
      await this.waitUntilReady(voiceChannel.id);
      this.connection.subscribe(this.player);
    } catch (error) {
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
    let lastError = null;

    for (let attempt = 1; attempt <= VOICE_CONNECT_MAX_ATTEMPTS; attempt += 1) {
      try {
        if (!this.connection) {
          throw new Error('Voice connection was not established.');
        }

        if (this.connection.state.status !== VoiceConnectionStatus.Ready) {
          await entersState(this.connection, VoiceConnectionStatus.Ready, VOICE_READY_TIMEOUT_MS);
        }
        return;
      } catch (error) {
        lastError = error;

        if (attempt === VOICE_CONNECT_MAX_ATTEMPTS) {
          break;
        }

        this.connection.rejoin({
          channelId,
          selfDeaf: true
        });
      }
    }

    throw lastError;
  }

  enqueueTracks(tracks) {
    this.queue.push(...tracks);
    if (!this.current) {
      this.playNext();
    }
  }

  playNext() {
    const next = this.queue.shift();
    this.current = next || null;

    if (!next) {
      return;
    }

    let resource;
    try {
      resource = createTrackResource(next, this.volume);
    } catch (error) {
      console.error(`Failed to create audio resource for track ${next.name}:`, error);
      this.playNext();
      return;
    }
    this.player.play(resource);
  }

  skip() {
    this.player.stop();
  }

  shuffleQueue() {
    this.queue = shuffleArray(this.queue);
  }

  setVolume(percent) {
    this.volume = Math.max(0, Math.min(percent, 200)) / 100;

    return Math.round(this.volume * 100);
  }

  leave() {
    if (this.connection) {
      this.connection.destroy();
      this.connection = null;
    }

    this.player.stop();
    this.queue = [];
    this.current = null;
  }
}

module.exports = {
  GuildMusicPlayer,
  shuffleArray
};
