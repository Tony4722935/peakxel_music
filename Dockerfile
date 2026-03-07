FROM node:20-bookworm-slim

WORKDIR /app

# ffmpeg is needed for decoding/transcoding local mp3/flac files.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
COPY README.md ./README.md

ENV NODE_ENV=production
ENV MUSIC_ROOT=/music

CMD ["node", "src/index.js"]
