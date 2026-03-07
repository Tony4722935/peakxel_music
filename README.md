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
3. Set env vars:
   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `DISCORD_GUILD_ID` (your local test server/guild id)
   - `MUSIC_ROOT` (optional, defaults to `./music`)

Example:

```bash
export DISCORD_TOKEN="..."
export DISCORD_CLIENT_ID="..."
export DISCORD_GUILD_ID="..."
export MUSIC_ROOT="/path/to/your/music"
npm start
```

## Docker setup

1. Copy the env template and fill it:
   ```bash
   cp .env.example .env
   ```
2. Update `.env` values:
   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `DISCORD_GUILD_ID`
   - `MUSIC_LIBRARY_PATH` (absolute host path containing playlist folders)
   - `REGISTER_COMMANDS_ON_START` (`true` by default; set to `false` to skip command registration)
3. Start the bot:
   ```bash
   docker compose up -d --build
   ```
4. View logs:
   ```bash
   docker compose logs -f
   ```

The compose file mounts your host music library as read-only at `/music` in the container and sets `MUSIC_ROOT=/music`.

### Troubleshooting 401 Unauthorized

If startup fails with `DiscordAPIError[0]: 401: Unauthorized`:

- Regenerate and update `DISCORD_TOKEN` from Discord Developer Portal.
- Verify `DISCORD_CLIENT_ID` matches the same application as the token.
- Verify `DISCORD_GUILD_ID` is the target server ID.
- If commands are already registered, set `REGISTER_COMMANDS_ON_START=false` to bypass command registration while validating token/login separately.

## Slash commands

- `/play playlist:<name> [track:<name>]` – queue playlist or specific track.
- `/skip` – skip current track.
- `/shuffle` – shuffle queue.
- `/volume level:<0-200>` – set volume.
- `/leave` – leave voice channel and clear queue.
- `/playlists` – list playlists discovered at startup.
- `/help` – show command help.
- `/functions` – alias for `/help`.

## Notes

- The library cache is generated once at startup.
- If you add/remove files, restart the bot to refresh cache.
