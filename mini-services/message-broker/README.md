# message-broker (port 3002)

Lightweight in-memory async message broker (RabbitMQ-style) for the Role-Based Microservice API Ecosystem.

Holds in-memory queues keyed by topic, supports publish / poll / ack / nack with retry (max 3 attempts → dead-letter), persists a JSON snapshot to disk on every state change (best-effort durability — reloaded on startup, with in-flight `DELIVERED` messages requeued as `PENDING` to honor durable-queue semantics), and streams live stats/updates over socket.io so the browser can watch queues in real time.

## Run

```bash
cd mini-services/message-broker
bun install
bun run dev   # bun --hot index.ts
```

Listens on **3002**.

## HTTP API

| Method | Path                  | Body                                              | Returns                                   |
|--------|-----------------------|---------------------------------------------------|-------------------------------------------|
| GET    | `/health`             | —                                                 | `{ status, service, uptimeSec }`          |
| POST   | `/broker/publish`     | `{ topic, payload, durable? }`                     | `{ messageId, topic, status, enqueuedAt }` |
| POST   | `/broker/poll`        | `{ topic, consumerId }`                            | `{ message: BrokerMessage \| null }`       |
| POST   | `/broker/ack`         | `{ messageId }`                                    | `{ status:"acked", messageId }`           |
| POST   | `/broker/nack`        | `{ messageId, reason? }`                           | `{ status:"requeued"\|"dead", messageId, attempts }` |
| GET    | `/broker/queues`      | —                                                 | `{ queues: QueueStats[] }`                |
| GET    | `/broker/messages`    | `?topic=&status=&limit=100` (query)                | `{ messages: BrokerMessage[], total }`    |
| GET    | `/broker/stats`       | —                                                 | `BrokerStats`                             |

CORS is open (`*`); OPTIONS returns 204.

## socket.io

- Path `/`, CORS `*`, methods `GET`/`POST`.
- On connection: emits current `stats`.
- Client emits `subscribe { topic }` → joins a topic room.
- Server emits to subscribers:
  - `message` — new message published to a topic.
  - `ack` — message acknowledged.
  - `nack` — message nacked (with new status and attempts).
  - `queue-update` — per-topic `QueueStats` (broadcast to all).
  - `stats` — global `BrokerStats` (broadcast every 1000ms and on every state change).

## Durability

Snapshot file: `mini-services/message-broker/snapshot.json`. Written synchronously on every publish/poll/ack/nack (best-effort). On startup, if the file exists, the state is restored. Any message that was `DELIVERED` (in-flight) at crash time is reset to `PENDING` so it gets redelivered — mirroring a durable-queue redelivery semantic.

## Retry / Dead-letter

`nack` increments `attempts`. At `attempts >= 3` the message becomes `DEAD` and is moved to the (bounded) dead log. Otherwise it is requeued as `PENDING` for another poll.

## Stats

- Global: `published, delivered, acked, failed, dead, uptimeSec` (lifetime) + `throughput` (acks/sec over a 10s sliding window).
- Per-topic `QueueStats`: `pending, delivered, acked, dead` + `throughput`.

No Prisma, no DB — only the JSON snapshot file.
