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

function createTrackResource(track) {
  const transcoder = new prism.FFmpeg({
    args: [
      '-hide_banner',
      '-loglevel',
      'panic',
      '-i',
      track.filePath,
      '-analyzeduration',
      '0',
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
    inlineVolume: true,
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
    const existing = getVoiceConnection(voiceChannel.guild.id);
    if (existing) {
      this.connection = existing;
      this.connection.subscribe(this.player);
      return;
    }

    this.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: false
    });

    await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    this.connection.subscribe(this.player);
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
      resource = createTrackResource(next);
    } catch (error) {
      console.error(`Failed to create audio resource for track ${next.name}:`, error);
      this.playNext();
      return;
    }
    if (resource.volume) {
      resource.volume.setVolume(this.volume);
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

    const current = this.player.state.resource;
    if (current && current.volume) {
      current.volume.setVolume(this.volume);
    }

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
