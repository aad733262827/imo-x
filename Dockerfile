FROM node:18-bullseye-slim

# Install ffmpeg and curl, then download yt-dlp binary
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp

WORKDIR /app

# Copy package files first and install deps (cache-friendly)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy app sources
COPY . .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
