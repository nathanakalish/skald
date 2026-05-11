# ── Stage 1: Build ────────────────────────────────────────────
FROM node:25-slim AS build

WORKDIR /app

# Install build tools needed by native modules (better-sqlite3, sharp)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Prune devDependencies for the runtime image
RUN npm ci --omit=dev

# ── Stage 2: Runtime ──────────────────────────────────────────
FROM node:25-slim AS runtime

WORKDIR /app

# sharp needs libvips at runtime; better-sqlite3 needs libc.
# wget is used by the HEALTHCHECK below.
# gosu is used by docker-entrypoint.sh to drop privileges to the skald user
# after fixing volume ownership (handles upgrades from older root-running images).
RUN apt-get update && \
    apt-get install -y --no-install-recommends libvips42 wget gosu && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user up front so subsequent COPY --chown lines work.
RUN groupadd --system --gid 1001 skald && \
    useradd --system --uid 1001 --gid skald --no-create-home --shell /usr/sbin/nologin skald

# Copy built app + production node_modules (owned by non-root user)
COPY --from=build --chown=skald:skald /app/build ./build
COPY --from=build --chown=skald:skald /app/node_modules ./node_modules
COPY --from=build --chown=skald:skald /app/package.json ./
# Migration files (read at runtime by the migrator)
COPY --from=build --chown=skald:skald /app/drizzle ./drizzle

# Static files served by SvelteKit (favicon, manifest, etc.)
# Avatars & data are mounted as volumes — copy only the base static assets
COPY --from=build --chown=skald:skald /app/static/favicon.svg ./static/
COPY --from=build --chown=skald:skald /app/static/icon-*.png ./static/
COPY --from=build --chown=skald:skald /app/static/manifest.webmanifest ./static/
COPY --from=build --chown=skald:skald /app/static/robots.txt ./static/

# Create volume mount-points so they exist even without a mount.
# Owned by skald so the non-root process can write.
RUN mkdir -p /app/data /app/static/avatars && \
    chown -R skald:skald /app/data /app/static/avatars

ENV NODE_ENV=production
ENV PORT=3000
ENV BODY_SIZE_LIMIT=26214400
# Let SvelteKit derive origin from the incoming request headers
# so it works behind any reverse proxy / Tailscale without hardcoding a URL
ENV PROTOCOL_HEADER=x-forwarded-proto
ENV HOST_HEADER=x-forwarded-host

EXPOSE 3000

# Volumes for persistent data
VOLUME ["/app/data", "/app/static/avatars"]

# Entrypoint runs as root, chowns the data volumes (in case they came from an
# older image that ran as root), then drops to the unprivileged `skald` user
# via gosu before exec'ing the Node process.
COPY --chown=root:root docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Liveness probe — orchestrators (Docker Swarm, K8s, Traefik, etc.) use this to
# know when the container is healthy. Returns non-zero when the DB is unreachable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- --tries=1 http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "build/index.js"]
