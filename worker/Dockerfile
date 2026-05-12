# Yandex Maps worker — Docker image for Dokploy
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

# Install worker deps
COPY worker/package.json worker/package-lock.json* ./
RUN npm install --omit=dev=false

# Copy source and build
COPY worker/tsconfig.json ./
COPY worker/src ./src
RUN npx tsc -p .

# Drop dev deps to slim image
RUN npm prune --omit=dev

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
