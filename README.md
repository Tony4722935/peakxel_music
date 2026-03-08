# Peakxel Discord Music App

Discord music bot that reads playlists from local folders and streams them to Discord voice channels.

## Requirements

- Node.js 22.12.0 or newer
- Discord bot token + application client ID + guild ID
- FFmpeg (included automatically in Docker image)

## Music Library Layout

Each subfolder is treated as one playlist.

```text
music/
  Chill/
    track1.mp3
    track2.flac
  Workout/
    song_a.mp3
```

Supported file types:

- `.mp3`
- `.flac`

## Configuration

Core environment variables:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID`
- `MUSIC_LIBRARY_PATH` (Docker only)

`/.env.example` contains these values.

## Run With npm (Local)

For npm/local runs, music must be under this project folder:

- `./music`

Steps:

1. Install dependencies.
   ```bash
   npm install
   ```
2. Create `.env` with:
   ```dotenv
   DISCORD_TOKEN=...
   DISCORD_CLIENT_ID=...
   DISCORD_GUILD_ID=...
   ```
3. Start bot.
   ```bash
   npm start
   ```

## Run With Docker (Production)

For Docker runs, host music path comes from `MUSIC_LIBRARY_PATH` and is mounted to `/music` in container.

1. Create env file.
   ```bash
   cp .env.example .env
   ```
2. Fill `.env`.
   ```dotenv
   DISCORD_TOKEN=...
   DISCORD_CLIENT_ID=...
   DISCORD_GUILD_ID=...
   MUSIC_LIBRARY_PATH=/absolute/path/to/your/music
   ```
3. Build image.
   ```bash
   docker compose build
   ```
4. Start in background.
   ```bash
   docker compose up -d
   ```

## Docker Operations

- Stop and remove running container(s):
  ```bash
  docker compose down
  ```
- Build image:
  ```bash
  docker compose build
  ```
- Build and start fresh:
  ```bash
  docker compose down
  docker compose build --no-cache
  docker compose up -d
  ```
- Recreate with latest compose config:
  ```bash
  docker compose up -d --build --force-recreate
  ```
- Follow logs:
  ```bash
  docker compose logs -f
  ```

## Slash Commands

- `/play playlist:<name>`: queue playlist in shuffled order
- `/queue`: show up to 10 tracks in queue (includes `[Playing]` and `[Next]`)
- `/skip`: skip current track
- `/shuffle`: shuffle queued tracks
- `/volume level:<0-200>`: set volume for upcoming tracks
- `/leave`: disconnect and clear queue
- `/playlists`: list discovered playlists
- `/help`: show help

## Notes

- Library cache is built on startup.
- After changing music files/folders, restart bot.
- Global slash-command deletion can take time to propagate in Discord clients.

## Troubleshooting

- Enable voice debug logs:
  ```bash
  VOICE_DEBUG=true npm start
  ```
- Flush stale slash commands from reused Discord app (run once):
  ```bash
  DISCORD_FLUSH_GLOBAL_COMMANDS=true DISCORD_FLUSH_GUILD_COMMANDS=true npm start
  ```
- If voice connect fails with DAVE-related close codes, verify:
  - Node.js is 22.12.0+
  - dependencies are installed from current `package.json`
