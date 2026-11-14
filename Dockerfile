# MarginPulse single-instance image (V3 CH-22). One Node process serves the built UI and the API on one origin.
# Status: CONFIGURED. This file has not been built in the authoring environment (no Docker daemon, registry blocked).
# TO_VERIFY before first build: confirm the tag below exists for your CPU architecture and pin it by digest
# (node:22.x is needed for the built-in node:sqlite module; the repo was tested on Node 22.22.0).
ARG NODE_IMAGE=node:22.22.0-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Optional, public (not a secret): Clarity project ID baked into the UI bundle (V3 CH-21). Empty = analytics off.
ARG VITE_CLARITY_PROJECT_ID=""
ENV VITE_CLARITY_PROJECT_ID=${VITE_CLARITY_PROJECT_ID}
# VITE_CLARITY_ALLOW_LOCAL must also be declared here or a build variable for it is silently ignored.
ARG VITE_CLARITY_ALLOW_LOCAL=""
ENV VITE_CLARITY_ALLOW_LOCAL=${VITE_CLARITY_ALLOW_LOCAL}
# Typecheck + Vite build, using the repo's own script.
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATABASE_PATH=/data/marginpulse.db
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/apps ./apps
COPY --from=build /app/packages ./packages
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/tsconfig.json ./tsconfig.json
# The database lives on a mounted volume, never in the image. SQLite sidecar files stay in the same directory.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# First boot seeds the volume database if empty (bootstrap is idempotent), then exec
# replaces the shell with Node so stop signals still reach the server directly.
CMD ["sh", "-c", "node --disable-warning=ExperimentalWarning --import tsx scripts/bootstrap.ts; exec node --disable-warning=ExperimentalWarning --import tsx apps/api/src/server.ts"]
