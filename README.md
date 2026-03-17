# Peakxel Music Bot

[![Node.js](https://img.shields.io/badge/Node.js-22.12%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?logo=discord&logoColor=white)](https://discord.js.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Self-hosted Discord music bot that loads playlists from local folders and streams them to voice channels.

## Why This Repo

- Global slash commands (works across multiple servers)
- Local music library from folders you control
- Fast startup with cached playlist scan
- Docker and local Node.js workflows
- Built-in voice connection diagnostics

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Configuration](#configuration)
- [Quick Start](#quick-start)
- [Slash Commands](#slash-commands)
- [Docker Operations](#docker-operations)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Features

- Playlist-as-folder model (`music/<playlist-name>/*.mp3|*.flac`)
- Per-server playback state and queue management
- Queue controls: skip, shuffle, volume, leave, queue preview
- Global command registration via Discord REST API
- Optional command flush for stale global command cleanup

## Architecture

```text
music/ (host filesystem)
  -> library builder (startup scan)
  -> command handler (/play, /skip, /queue, ...)
  -> guild player map (isolated queue/player per server)
  -> Discord voice connection + FFmpeg stream
```

Main files:

- `src/index.js` - bot bootstrap, command registration, interaction handling
- `src/library.js` - music library discovery and cache model
- `src/player.js` - queueing, playback, and voice transport lifecycle

## Prerequisites

- Node.js `22.12.0` or newer
- Discord bot token + application client ID
- FFmpeg (auto-provided by Docker image)

## Configuration

Core environment variables:

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | Yes | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Yes | Application (bot) client ID |
| `MUSIC_LIBRARY_PATH` | Docker only | Host path mounted to `/music` in container |
| `DISCORD_FLUSH_GLOBAL_COMMANDS` | Optional | Set `true` to clear global commands before registering |
| `DISCORD_DNS_RESULT_ORDER` | Optional | DNS strategy (default: `ipv4first`) |

Example local `.env`:

```dotenv
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_id
```

## Quick Start

### Option A: Run locally with npm

1. Install dependencies.

```bash
npm install
```

2. Create `.env` in project root.

```dotenv
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
```

3. Place music under `./music`.

```text
music/
  Chill/
    track1.mp3
  Workout/
    track2.flac
```

4. Start bot.

```bash
npm start
```

### Option B: Run with Docker

1. Copy env template.

```bash
cp .env.example .env
```

2. Fill `.env`.

```dotenv
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
MUSIC_LIBRARY_PATH=/absolute/path/to/your/music
```

3. Build and run.

```bash
docker compose build
docker compose up -d
```

## Slash Commands

| Command | Description |
|---|---|
| `/play playlist:<name>` | Queue the selected playlist in shuffled order |
| `/skip` | Skip current track |
| `/shuffle` | Shuffle remaining queue |
| `/queue` | Show current queue preview |
| `/volume level:<0-200>` | Set playback volume |
| `/leave` | Leave voice and clear queue |
| `/playlists` | List cached playlists discovered at startup |
| `/help` | Show command help |

## Docker Operations

```bash
# Stop/remove
docker compose down

# Rebuild
docker compose build

# Full refresh
docker compose down
docker compose build --no-cache
docker compose up -d

# Logs
docker compose logs -f
```

## Troubleshooting

Enable voice diagnostics:

```bash
VOICE_DEBUG=true npm start
```

Flush stale global commands once:

```bash
DISCORD_FLUSH_GLOBAL_COMMANDS=true npm start
```

If voice connection fails repeatedly:

- Verify Node.js `22.12.0+`
- Reinstall dependencies from current `package.json`
- Confirm bot token and client ID belong to the same Discord app

## Security Notes

- Never commit real bot tokens
- Rotate token immediately if exposed
- Keep `.env` private

## License

Distributed under the MIT License. See [LICENSE](./LICENSE).
