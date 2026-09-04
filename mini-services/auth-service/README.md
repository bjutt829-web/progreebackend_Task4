# auth-service

Mini-service for the Role-Based Microservice API Ecosystem. Owns the `User` and `AuthAudit` tables, issues and verifies HS256 JWTs, and enforces RBAC.

## Endpoints (port 3001)

| Method | Path              | Auth            | Description                                              |
|--------|-------------------|-----------------|---------------------------------------------------------|
| GET    | `/health`         | none            | `{ status:"ok", service:"auth-service", uptimeSec }`    |
| POST   | `/auth/seed`      | none            | Idempotent seeding of the 3 default users if DB empty.  |
| POST   | `/auth/login`     | none            | `{ email, password }` → `{ token, user }` (401 on fail) |
| POST   | `/auth/register`  | Bearer (ADMIN)  | `{ email, name, password, role? }` → `{ user }` (409 dup) |
| GET    | `/auth/verify`    | Bearer          | `{ valid, user?, reason? }`                             |
| GET    | `/auth/me`        | Bearer          | `{ user }`                                              |
| GET    | `/auth/users`     | Bearer (ADMIN)  | `{ users: UserPublic[] }` (403 for non-admin)            |
| OPTIONS| any               | none            | CORS preflight → 204                                    |

## Default seeded users (auto-created on first start)

| email              | password    | role    |
|--------------------|-------------|---------|
| admin@corp.io      | admin123    | ADMIN   |
| manager@corp.io    | manager123  | MANAGER |
| user@corp.io       | user123     | USER    |

## Environment variables

- `DATABASE_URL` — Prisma SQLite URL. Defaults to `file:/home/z/my-project/db/custom.db`.
- `JWT_SECRET` — HS256 secret. Defaults to the value in `../shared/contracts.ts`.
- `PRISMA_LOG` — set to `1` to enable Prisma query/error logging.

## CORS

Every response includes:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

## Run

```bash
cd mini-services/auth-service
bun install
DATABASE_URL=file:/home/z/my-project/db/custom.db bun run db:generate
DATABASE_URL=file:/home/z/my-project/db/custom.db bun run dev
```

## Implementation notes

- No external JWT/bcrypt deps. HS256 uses Node `crypto.createHmac`; passwords use `crypto.scryptSync` with a 16-byte salt stored as `saltHex:hashHex`.
- Token verification uses `crypto.timingSafeEqual` for both signature and password comparisons.
- All login/register/access-denied/token-verify events are persisted into the `AuthAudit` table.
- Each request is logged to stdout as `METHOD /path -> status in Xms`.
- Graceful shutdown on SIGINT/SIGTERM disconnects Prisma and stops the HTTP server.
