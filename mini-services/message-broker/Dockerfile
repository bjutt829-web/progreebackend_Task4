# message-broker container image.
# Owns: in-memory queues + JSON snapshot file (no Prisma, no DB).
# Listens on 3002. Attached to the isolated `broker-tier` network only.
#
# Build context is the project root (`.`) so the Dockerfile can COPY the shared
# wire contracts (mini-services/shared/contracts.ts) which the broker imports
# via `../shared/contracts`. In the image the service is at /app (WORKDIR),
# so `../shared/contracts` -> /shared/contracts (we COPY contracts there).
#
# Snapshot persistence:
#   The broker (see mini-services/message-broker/index.ts) currently HARD-CODES
#   its snapshot path to the dev location
#     /home/z/my-project/mini-services/message-broker/snapshot.json
#   rather than reading an env var. To keep the snapshot durable in the
#   container we (a) recreate that parent directory in the image and (b) mount
#   the `broker-snap` named volume on it in docker-compose, so snapshot.json
#   is written into the volume and survives restarts.
#   `BROKER_SNAPSHOT_PATH` is also exported as a forward-looking hook: if the
#   broker is later updated to read it, the compose can switch the volume
#   mount to /app/data with no other changes.
#
# NOTE on RabbitMQ: this image ships the in-memory broker used by the demo. In a
# full production topology the broker would bridge to the `rabbitmq` service
# (rabbitmq:3-management) declared in docker-compose.yml on the broker-tier
# network. We keep the in-memory image so the demo stays self-contained; the
# RabbitMQ container is still started in the compose topology as the
# production-grade backbone reference.

FROM oven/bun:1

WORKDIR /app

# Shared wire contracts (imported by the broker as ../shared/contracts).
COPY mini-services/shared/contracts.ts /shared/contracts.ts

# Install dependencies first for better layer caching.
COPY mini-services/message-broker/package.json ./
RUN bun install

# Service source (index.ts, ...). .dockerignore excludes node_modules.
COPY mini-services/message-broker/ ./

# Recreate the broker's hard-coded snapshot directory so writeFileSync succeeds
# and so the `broker-snap` volume mount (compose) has a valid mount point.
RUN mkdir -p /home/z/my-project/mini-services/message-broker

ENV NODE_ENV=production
# Forward-looking hook — the broker does not read this yet (see header comment).
ENV BROKER_SNAPSHOT_PATH=/home/z/my-project/mini-services/message-broker/snapshot.json

EXPOSE 3002

CMD ["bun", "run", "index.ts"]
