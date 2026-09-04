# transaction-service container image.
# Owns: Transaction + QueueMessage + TxnAudit tables (Prisma + SQLite).
# Listens on 3003. Attached to BOTH `txn-tier` and `broker-tier` networks:
#   - txn-tier   : its own private tier (DB traffic isolated)
#   - broker-tier: so it can POLL the message-broker to consume/ack messages
#                  without the broker being exposed to the public or to auth.
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
#     .prisma/client — no project-root node_modules, no `rsync` needed.
#
# NOTE: the service's `db:generate` npm script uses `rsync` (not present in the
# `oven/bun:1` image) and assumes the project-root node_modules layout
# (`../../node_modules/.prisma/client`), neither of which exist in a container.
# We therefore bypass the script and run `bunx prisma generate` against a
# locally-staged schema, which is the equivalent, container-clean operation.

FROM oven/bun:1

WORKDIR /app

# Shared wire contracts (imported by the service as ../shared/contracts).
COPY mini-services/shared/contracts.ts /shared/contracts.ts

# Install dependencies first for better layer caching.
COPY mini-services/transaction-service/package.json ./
RUN bun install

# Service source (index.ts, db.ts, broker-client.ts, ...). .dockerignore
# excludes node_modules so the host's install is not copied over the image's.
COPY mini-services/transaction-service/ ./

# Stage the shared Prisma schema locally so prisma generate emits the client
# into /app/node_modules/.prisma/client (the location @prisma/client expects).
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN bunx prisma generate

# Each transaction-service instance gets its own SQLite file at /data/txn.db
# (mounted as the `txn-db` named volume in docker-compose).
ENV DATABASE_URL=file:/data/txn.db
# The service polls the broker here (resolvable via the broker-tier network).
ENV BROKER_URL=http://message-broker:3002
ENV NODE_ENV=production

EXPOSE 3003

CMD ["bun", "run", "index.ts"]
