# Peakxel Discord Music App

A Discord bot that scans a local music folder at startup and builds an in-memory playlist cache.

- Each subfolder inside `MUSIC_ROOT` is treated as a playlist.
- Playlist name = folder name.
- Supported files: `.mp3` and `.flac`.
- To refresh playlists, update files/folders and restart the app.

## Folder structure

```text
music/
  Chill/
    track1.mp3
    track2.flac
  Workout/
    song_a.mp3
```

## Local setup (Node)

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a Discord application + bot and invite it to your server with bot + applications.commands scopes.
3. Configure environment values (the app automatically loads them from a local `.env` file if present):
   - `DISCORD_TOKEN` (or `TOKEN`)
   - `DISCORD_CLIENT_ID` (or `APPLICATION_ID`)
   - `DISCORD_GUILD_ID` (or `DEV_GUILD`)
   - `MUSIC_ROOT` (optional, defaults to `./music`)
  - `DISCORD_DNS_RESULT_ORDER` (optional, defaults to `ipv4first` to avoid IPv6 voice handshake issues in some Docker hosts)

Example `.env`:

```dotenv
DISCORD_TOKEN=...
# TOKEN=...
DISCORD_CLIENT_ID=...
# APPLICATION_ID=...
DISCORD_GUILD_ID=...
# DEV_GUILD=...
MUSIC_ROOT=/path/to/your/music
```

Then run:

```bash
npm start
```

## Docker setup

1. Copy the env template and fill it:
   ```bash
   cp .env.example .env
   ```
2. Update `.env` values:
   - `DISCORD_TOKEN` (or `TOKEN`)
   - `DISCORD_CLIENT_ID` (or `APPLICATION_ID`)
   - `DISCORD_GUILD_ID` (or `DEV_GUILD`)
   - `MUSIC_LIBRARY_PATH` (absolute host path containing playlist folders)
   - `DISCORD_DNS_RESULT_ORDER` (optional, defaults to `ipv4first`)
   - `DOCKER_NETWORK_MODE` (optional, defaults to `host`; set `bridge` on platforms where host networking is unavailable)
3. Start the bot:
   ```bash
   docker compose up -d --build
   ```
4. View logs:
   ```bash
   docker compose logs -f
   ```

The compose file mounts your host music library as read-only at `/music` in the container and sets `MUSIC_ROOT=/music`. It also defaults to `network_mode: host` so Discord voice UDP traffic works reliably in Docker on Linux hosts.

The Docker image installs `ffmpeg` (required by the playback pipeline) and installs Node dependencies from `package.json` (including the supported voice encryption backend `libsodium-wrappers`). Playback uses FFmpeg Opus output directly, so no additional Node Opus module is required in the container. If you were already running the bot, rebuild after pulling changes: `docker compose up -d --build --force-recreate`.

## Slash commands

- `/play playlist:<name>` – queue the full playlist in a freshly shuffled order each time.
- `/skip` – skip current track.
- `/shuffle` – shuffle queue.
- `/volume level:<0-200>` – set volume for upcoming tracks (applies when next track starts).
- `/leave` – leave voice channel and clear queue.
- `/playlists` – list playlists discovered at startup.
- `/help` – show command help.

## Notes

- The library cache is generated once at startup.
- If you add/remove files, restart the bot to refresh cache.

## Voice connection troubleshooting

- The bot now prints detailed voice lifecycle logs (connection state changes, ready attempts, and queue/playback events) to help diagnose Docker/network issues.
- If voice connect repeatedly times out in Docker, keep `DISCORD_DNS_RESULT_ORDER=ipv4first` (default) to prevent IPv6-first DNS resolution from breaking the Discord voice handshake on hosts without working IPv6 routing.
- If logs loop between `connecting` and `signalling` in Docker, use `DOCKER_NETWORK_MODE=host` (default in `docker-compose.yml`) on Linux so Discord voice UDP packets are not blocked by bridge/NAT behavior.
- The bot logs the `@discordjs/voice` dependency report at startup and now validates that a currently supported encryption library is available (`libsodium-wrappers`, `sodium`, `sodium-native`, `@noble/ciphers`, or `@stablelib/xchacha20poly1305`). If none are detected, startup fails fast with a clear error before attempting voice joins.
- After changing env vars, recreate the container: `docker compose up -d --build --force-recreate`.
