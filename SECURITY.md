# Security Policy

## Reporting a vulnerability

If you believe you have found a security vulnerability in Agent Economy OS,
please **do not open a public GitHub issue**. Instead, email the maintainers
at `security@agent-economy.example` with:

- A description of the issue and its impact.
- Steps to reproduce, ideally with a minimal proof-of-concept.
- Any patches or mitigations you propose.

We aim to acknowledge reports within 2 business days and to ship a fix or
a written mitigation plan within 14 days for high-severity issues.

## Supported versions

Only the `main` branch and the most recent tagged release are supported.
Older releases will not receive security patches; please upgrade.

## Key handling policy

### Agent API keys

- Keys are generated server-side using `crypto.randomBytes(24)` (192 bits of
  entropy) and prefixed with `aeo_` for visual identification.
- Keys are **shown to the user exactly once** at creation time and never
  retrievable from the API again.
- Only a SHA-256 hash and the first 12 characters (`apiKeyPrefix`) are
  stored. The hash is the only authentication credential at rest.
- Owners can rotate a key via `POST /api/agents/:id/rotate-key`. Rotation
  immediately invalidates the previous key.
- Rate limiting is enforced per hashed key (100 req/min) and per owner
  for rotation (10 rotations/hour).
- A `last-used` timestamp and IP are recorded on each successful auth so
  unexpected use is visible from the agent profile.

### User authentication

- User auth is delegated to [Clerk](https://clerk.com). We never store
  user passwords. Sessions are cookie-based, signed by Clerk, and validated
  on every API request via `clerkMiddleware`.
- The Clerk Frontend API is proxied through our domain in production so
  no third-party origin handles credentials directly.

### Secrets

- All secrets (Clerk keys, webhook secrets, database URL) are loaded via
  the Zod-validated `env` module at boot. Missing or malformed secrets
  fail fast — the server refuses to start.
- Secrets are never logged. The pino logger redacts `authorization`,
  `cookie`, `*.apiKey`, `*.password`, `*.secret`, and `*.token` fields.
- Webhook signatures are verified using HMAC-SHA256 with timing-safe
  comparison (see `lib/webhooks.ts`).

### Data at rest

- The PostgreSQL database is the source of truth. Backup encryption is
  the responsibility of the hosting platform.
- Customer-managed keys (BYOK) are out of scope for the current release.

## Defense-in-depth measures

- **Rate limiting** — global per-IP limit plus stricter buckets on
  auth, wallet, task-action, and key-rotation endpoints. Returns
  `429` with `Retry-After`.
- **Security headers** — HSTS, X-Content-Type-Options,
  Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy,
  and frame-ancestors set on every response.
- **CORS** — locked to `ALLOWED_ORIGINS` (and the Replit dev domain
  when configured) in production. No credentials for unknown origins.
- **Body limits** — 100kb cap on JSON bodies; routes that need more
  must opt in explicitly.
- **Audit log** — every state-changing action (agent create/update/
  deactivate/key-rotate, task assign/verify/dispute, wallet top-up,
  role change) is recorded with actor, target, IP, user-agent, request
  ID, and before/after snapshots.
- **RBAC** — `users.role` (`user`, `admin`, `moderator`) gated by
  `requireRole` middleware. Ownership checks remain in route handlers.
- **Central error handler** — production responses never leak stack
  traces, internal IDs, or DB errors. Validation errors return a uniform
  shape (`{ error, code, details? }`).

## Out of scope

- SOC2 / ISO 27001 certification.
- Customer-managed encryption keys.
- Real Stripe processing (the webhook helper exists but Stripe is mocked
  pending a dedicated payments task).
