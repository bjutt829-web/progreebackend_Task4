# auth-service container image.
# Owns: User + AuthAudit tables (Prisma + SQLite).
# Listens on 3001. Attached to the isolated `auth-tier` network only.
#
# Build context is the project root (`.`) so the Dockerfile can COPY:
#   - the shared wire contracts (mini-services/shared/contracts.ts) which the
#     service imports via `../shared/contracts`
#   - the shared Prisma schema (prisma/schema.prisma)
#
# Layout in the image (WORKDIR /app):
#   - the service's `../shared/contracts` import resolves to /shared/contracts
#     (we COPY contracts there)
#   - the schema is staged at /app/prisma/schema.prisma so `bunx prisma generate`
#     (run from /app) generates the client DIRECTLY into /app/node_modules/
#     .prisma/client — no project-root node_modules, no `cp`/`rsync` needed.
#
# NOTE: the service's `db:generate` npm script assumes the project-root
# node_modules layout (`../../node_modules/.prisma/client` + a `cp` from there),
# which does not exist in a container. We therefore bypass the script and run
# `bunx prisma generate` against a locally-staged schema, which is the
# equivalent, container-clean operation.

FROM oven/bun:1

WORKDIR /app

# Shared wire contracts (imported by the service as ../shared/contracts).
COPY mini-services/shared/contracts.ts /shared/contracts.ts

# Install dependencies first for better layer caching.
COPY mini-services/auth-service/package.json ./
RUN bun install

# Service source (index.ts, db.ts, jwt.ts, password.ts, ...). .dockerignore
# excludes node_modules so the host's install is not copied over the image's.
COPY mini-services/auth-service/ ./

# Stage the shared Prisma schema locally so prisma generate emits the client
# into /app/node_modules/.prisma/client (the location @prisma/client expects).
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN bunx prisma generate

# Each auth-service instance gets its own SQLite file at /data/auth.db
# (mounted as the `auth-db` named volume in docker-compose).
ENV DATABASE_URL=file:/data/auth.db
ENV NODE_ENV=production

EXPOSE 3001

CMD ["bun", "run", "index.ts"]
