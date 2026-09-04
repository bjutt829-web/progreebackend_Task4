# Role-Based Microservice API Ecosystem with Asynchronous Message Brokers

A modular multi-tier application backend that handles database traffic securely under heavy loads. Built with JWT-secured role-based access control (RBAC), an in-memory asynchronous message broker coordinating transactions without database locks, and Docker Compose orchestration across isolated tier networks.

> Task 4 mini-project deliverable.

---

## Architecture

```
                     Browser (Preview Panel)
                            |
                            v  (relative paths via Caddy gateway)
                   Next.js API Gateway (port 3000)
                   - Pure orchestration + RBAC enforcement
                   - No direct DB access
                /              |              \
               v               v               v
   auth-service:3001   message-broker:3002   transaction-service:3003
   owns: User,          owns: in-memory       owns: Transaction, QueueMessage,
         AuthAudit        queues + JSON        TxnAudit
   JWT HS256 + RBAC      snapshot, socket.io  producer + background consumer
                                               (pulls from broker, ack/nack)
```

### Data ownership
- **auth-service** owns `User` + `AuthAudit` (its own Prisma client).
- **transaction-service** owns `Transaction` + `QueueMessage` + `TxnAudit` (its own Prisma client).
- **message-broker** owns in-memory runtime + a JSON snapshot file (no Prisma).
- **Next.js gateway** owns NO tables — it is a pure API gateway/BFF that verifies JWTs via auth-service and routes calls.

### Shared DB
SQLite at `db/custom.db`. Multiple Prisma clients all connect to the same file; each service only reads/writes the tables it "owns".

### Default seeded users (auth-service auto-seeds on first start)
| Email | Password | Role |
|---|---|---|
| admin@corp.io | admin123 | ADMIN |
| manager@corp.io | manager123 | MANAGER |
| user@corp.io | user123 | USER |

---

## Quick start (local dev)

### Prerequisites
- [Bun](https://bun.sh/) runtime
- Node.js 18+ (for Next.js)

### 1. Install dependencies
```bash
# Root (Next.js gateway + Prisma)
bun install

# Each mini-service
cd mini-services/auth-service && bun install
cd ../message-broker && bun install
cd ../transaction-service && bun install
# test-runner has no deps (uses global fetch)
```

### 2. Generate Prisma clients
The Prisma schema lives at `prisma/schema.prisma` and is shared. Each Prisma-using service generates its own client:
```bash
bun run db:generate          # root
cd mini-services/auth-service && bun run db:generate
cd ../transaction-service && bun run db:generate
```

### 3. Push the database schema
```bash
bun run db:push
```
This creates all tables (`User`, `Transaction`, `QueueMessage`, `AuthAudit`, `TxnAudit`) in `db/custom.db`.

### 4. Start the services (each in its own terminal)
```bash
# Terminal 1 — message broker (must be first, others depend on it)
cd mini-services/message-broker && bun run dev          # http://localhost:3002

# Terminal 2 — auth service
cd mini-services/auth-service && DATABASE_URL=file:../../db/custom.db bun run dev  # :3001

# Terminal 3 — transaction service
cd mini-services/transaction-service && DATABASE_URL=file:../../db/custom.db bun run dev  # :3003

# Terminal 4 — Next.js gateway
bun run dev                                              # http://localhost:3000
```

### 5. Open the dashboard
Visit `http://localhost:3000` and sign in with one of the demo accounts above (or use the quick-login buttons).

---

## Production deployment (Docker Compose)

```bash
docker compose up --build
```

This builds and starts all services across **four isolated networks**:
- `gateway-tier` (bridged — the only externally exposed network, port 3000)
- `auth-tier` (internal — auth-service)
- `broker-tier` (internal — message-broker + rabbitmq reference)
- `txn-tier` (internal — transaction-service, which also bridges to `broker-tier` to poll the broker)

See `docker-compose.yml` for the full topology and the attachment matrix.

---

## Automated endpoint verification

A 22-case black-box test suite drives the whole ecosystem through the gateway:

```bash
# Via the dashboard: Tests tab → "Run suite" (ADMIN only)
# Or standalone:
cd mini-services/test-runner && GATEWAY_URL=http://localhost:3000 bun run run.ts
```

Suites: `health` (1), `auth` (9), `broker` (3), `transactions` (6), `audit` (2), `tests` (1) — **22/22 pass, 100%**.

---

## RBAC permission matrix

| Permission | ADMIN | MANAGER | USER |
|---|---|---|---|
| users:read | ✓ | | |
| users:write | ✓ | | |
| transactions:read:all | ✓ | ✓ | |
| transactions:read:own | | | ✓ |
| transactions:write | ✓ | ✓ | ✓ |
| transactions:approve | ✓ | ✓ | |
| broker:read | ✓ | ✓ | |
| audit:read | ✓ | ✓ | own only |
| tests:run | ✓ | | |
| consumer:control | ✓ | | |

---

## API reference (gateway, port 3000)

### Auth
- `POST /api/auth/login` — `{email, password}` → `{token, user}`
- `POST /api/auth/register` — ADMIN only → creates a user
- `GET  /api/auth/me` — bearer token → current user
- `GET  /api/auth/verify` — bearer token → `{valid, user}`
- `GET  /api/auth/users` — ADMIN only → list all users
- `POST /api/auth/seed` — idempotent seed of demo users

### Transactions
- `POST /api/transactions` — `{type, amount, currency?, reference, metadata?}` → publishes to broker
- `GET  /api/transactions?limit=` — ADMIN/MANAGER: all; USER: own only
- `GET  /api/transactions/:id` — RBAC scoped
- `POST /api/transactions/:id/approve` — MANAGER/ADMIN only

### Broker
- `GET  /api/broker/stats` — ADMIN/MANAGER → global + per-topic stats
- `GET  /api/broker/queues` — ADMIN/MANAGER
- `GET  /api/broker/messages?topic=&status=&limit=` — ADMIN/MANAGER
- `POST /api/broker/publish` — ADMIN only → `{topic, payload, durable?}`

### Audit
- `GET /api/audit?limit=` — merged AuthAudit + TxnAudit (RBAC scoped)

### System
- `GET  /api/services/health` — unified health of all 3 backends
- `POST /api/tests/run` — ADMIN only → runs the 22-case suite
- `POST /api/admin/consumer/start|stop` — ADMIN only
- `GET  /api/admin/consumer/status` — ADMIN only
- `GET  /api/docs/docker-compose` — serves the compose file

### Real-time
- `io('/?XTransformPort=3002')` — socket.io live broker stats (via Caddy gateway)

---

## Project structure

```
.
├── prisma/schema.prisma              # shared DB schema (User, Transaction, QueueMessage, AuthAudit, TxnAudit)
├── src/
│   ├── app/
│   │   ├── page.tsx                  # dashboard (login + 6 tabs)
│   │   ├── layout.tsx
│   │   └── api/                      # gateway routes (20 routes, pure orchestration)
│   ├── components/dashboard/         # 9 dashboard components
│   ├── hooks/                        # use-broker-socket, use-services-health
│   └── lib/                          # services.ts (gateway), api.ts, auth-store.ts, eco.ts (client RBAC)
├── mini-services/
│   ├── shared/contracts.ts           # canonical wire types + RBAC + ports
│   ├── auth-service/                 # port 3001 — JWT HS256 + RBAC
│   ├── message-broker/               # port 3002 — in-memory pub/sub + socket.io
│   ├── transaction-service/          # port 3003 — producer + consumer
│   └── test-runner/                  # 22-case endpoint verification suite
├── docker-compose.yml                # 4-network isolated topology
├── Dockerfile.gateway                # Next.js standalone build
├── Caddyfile                         # dev gateway (XTransformPort routing)
└── worklog.md                        # full build log
```

---

## How the async broker avoids DB locks

1. A transaction is submitted → `transaction-service` creates a `Transaction` (PENDING), publishes a message to the `transactions` topic on the broker, persists a `QueueMessage`, and returns immediately (status QUEUED). The caller never blocks on the DB.
2. A background consumer in `transaction-service` polls the broker every 600ms, marks the transaction PROCESSING, simulates work (200–600ms), then acks (→ COMPLETED) or nacks (→ requeued; after 3 nacks → FAILED + dead-letter).
3. The broker holds messages in memory + a JSON snapshot for durability; the DB is only touched for quick status updates, never held under a long lock.

---

## Tech stack
- Next.js 16 (App Router) + TypeScript 5
- Tailwind CSS 4 + shadcn/ui (New York)
- Prisma ORM + SQLite
- Bun (mini-services runtime)
- socket.io (live broker stats)
- Zustand (client state) + TanStack Query (server state, available)
- JWT (HS256, hand-rolled with Node crypto — no external JWT lib)
- Docker Compose (production topology)

---

See `worklog.md` for the complete build log and `mini-services/*/README.md` for per-service docs.
