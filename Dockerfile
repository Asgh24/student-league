# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Student Comprehensive League - production image
#
# Stage 1 installs production dependencies. better-sqlite3 13 is a Node-API
# addon that ships its compiled binaries inside the npm package, for glibc
# (linux-x64) and musl (linuxmusl-x64) alike, so nothing is compiled here and
# no toolchain is required. Node 22 is the floor its `engines` field declares.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------------------------------------------------------------------------
# Stage 2 is the running image: no dev dependencies, non-root.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

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
