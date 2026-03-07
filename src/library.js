const fs = require('fs');
const path = require('path');

const SUPPORTED_EXTENSIONS = new Set(['.mp3', '.flac']);

function readTracksFromFolder(folderPath) {
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      name: path.parse(entry.name).name,
      filePath: path.join(folderPath, entry.name),
      ext: path.extname(entry.name).toLowerCase()
    }))
    .filter((track) => SUPPORTED_EXTENSIONS.has(track.ext));
}

function buildLibrary(musicRoot) {
  if (!fs.existsSync(musicRoot)) {
    throw new Error(`Music root folder does not exist: ${musicRoot}`);
  }

  const rootEntries = fs.readdirSync(musicRoot, { withFileTypes: true });
  const playlists = {};

  for (const entry of rootEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const playlistName = entry.name;
    const playlistPath = path.join(musicRoot, playlistName);
    const tracks = readTracksFromFolder(playlistPath);

    if (tracks.length > 0) {
      playlists[playlistName] = tracks;
    }
  }

  return {
    musicRoot,
    generatedAt: new Date().toISOString(),
    playlists
  };
}

module.exports = {
  buildLibrary,
  SUPPORTED_EXTENSIONS
};
