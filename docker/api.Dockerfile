FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install --no-install-recommends -y ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci

COPY backend ./backend
COPY frontend ./frontend
COPY eslint.config.js ./
RUN npm run build -w backend && npm prune --omit=dev

ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "backend/dist/server.js"]
