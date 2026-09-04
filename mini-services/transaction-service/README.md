# transaction-service

Bun.serve mini-service (port **3003**) for the Role-Based Microservice API Ecosystem.

It owns three Prisma tables (`Transaction`, `QueueMessage`, `TxnAudit`) on the shared SQLite DB, and plays two roles:

1. **Producer** — `POST /transactions` validates the request, persists a `Transaction` (PENDING), publishes the payload to the message-broker (`http://localhost:3002/broker/publish`), then stores a matching `QueueMessage` row and flips the transaction to `QUEUED`.
2. **Background consumer** — a `setInterval` loop (every 600ms) polls `POST http://localhost:3002/broker/poll` for the `transactions` topic, processes each message (with a ~6% simulated failure to demonstrate nack/retry), and acks/nacks the broker accordingly.

Identity is supplied by the gateway via the `x-user-id`, `x-user-email`, `x-user-role` headers (the gateway verifies the JWT against `auth-service` before forwarding). The service performs a **secondary RBAC check** on role-sensitive endpoints (e.g. `approve` requires MANAGER/ADMIN, USER list filters to own).

## Endpoints

| Method | Path                          | RBAC                  | Description                                                        |
|--------|-------------------------------|-----------------------|-------------------------------------------------------------------|
| GET    | `/health`                     | public                | `{ status, service, uptimeSec, consumerRunning }`                |
| POST   | `/transactions`               | any verified caller   | Create + enqueue transaction; returns `{ transaction, messageId }`|
| GET    | `/transactions?limit=100`     | ADMIN/MANAGER all; USER own | List transactions                                            |
| GET    | `/transactions/:id`           | ADMIN/MANAGER any; USER own | Fetch single transaction (403 if USER + foreign)              |
| POST   | `/transactions/:id/approve`   | MANAGER/ADMIN only    | Manually mark transaction COMPLETED + processedAt                 |
| GET    | `/audit?limit=100`            | ADMIN/MANAGER all; USER own (by email) | TxnAudit entries                                  |
| POST   | `/admin/consumer/start`       | public (admin via gateway) | Set `consumerRunning=true` (idempotent)                  |
| POST   | `/admin/consumer/stop`        | public (admin via gateway) | Set `consumerRunning=false`                              |
| GET    | `/admin/consumer/status`      | public                | `{ running }`                                                     |

## Consumer behavior

Every 600ms while `consumerRunning`:

1. `broker.poll("transactions", "txn-consumer-1")`.
2. If empty → return.
3. Find `Transaction` by `payload.transactionId`; mark PROCESSING; mark `QueueMessage` status DELIVERED; write `PROCESS` audit.
4. `await sleep(random 200-600ms)`. ~6% random simulated failure.
5. **On success:** `broker.ack(messageId)`; set Transaction COMPLETED + processedAt; QueueMessage ACK + ackedAt; `COMPLETE` audit.
6. **On failure:** `broker.nack(messageId, "simulated processing failure")`.
   - If nack response signals "dead" (3rd failure) → Transaction FAILED; QueueMessage DEAD; `FAIL` audit.
   - Else (requeued) → Transaction QUEUED again; QueueMessage NACK + error; `NACK` audit; the broker will re-deliver and the next poll will reprocess.

Each tick is wrapped in try/catch so a single bad message never kills the loop.

## Run

```bash
cd /home/z/my-project/mini-services/transaction-service
bun install
DATABASE_URL=file:/home/z/my-project/db/custom.db bun run db:generate
DATABASE_URL=file:/home/z/my-project/db/custom.db bun run dev
```

The message-broker (port 3002) must be running for the producer/consumer to function.
