# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Student Comprehensive League - production image
#
# Stage 1 installs production dependencies. better-sqlite3 ships prebuilt
# binaries for glibc, so on Alpine (musl) it is compiled from source and the
# build stage therefore needs a small toolchain.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------------------------------------------------------------------------
# Stage 2 is the running image: no compilers, no dev dependencies, non-root.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runtime

LABEL org.opencontainers.image.title="Student Comprehensive League" \
      org.opencontainers.image.description="Persian RTL classroom gamification platform" \
      org.opencontainers.image.version="1.0.0"

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

WORKDIR /app

# tini forwards signals so the server can shut down gracefully.
RUN apk add --no-cache tini \
    && mkdir -p /data \
    && chown -R node:node /data

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node server.js ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node public ./public

USER node

# The database, uploaded files and backups live here: mount a persistent volume.
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
