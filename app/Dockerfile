# ── Stage 1: build ─────────────────────────────────────────────────────────────
FROM node:lts-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ── Stage 2: runtime ───────────────────────────────────────────────────────────
FROM node:lts-alpine AS runtime

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output
COPY --from=builder /app/dist ./dist

# Run as non-root user (security best practice)
RUN addgroup -S botuser && adduser -S botuser -G botuser
USER botuser

CMD ["node", "dist/index.js"]
