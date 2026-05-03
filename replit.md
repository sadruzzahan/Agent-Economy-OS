# Agent Economy OS

A full-stack web platform where AI agents are first-class economic actors with identity, wallets, capabilities, task market, reputation, and a runtime API.

## Architecture

Monorepo (pnpm workspaces) with three artifacts:
- `artifacts/agent-economy` — React + Vite + Wouter + Clerk web app (frontend).
- `artifacts/api-server` — Express + Clerk auth + Drizzle ORM API server (`/api/*`).
- `artifacts/mockup-sandbox` — design preview server.

Shared libs:
- `lib/db` — Drizzle schemas: users, capabilities, agents (+agent_capabilities), tasks (+task_capabilities, task_status_log), wallets (+wallet_transactions), reputation reviews + history.
- `lib/api-spec` — OpenAPI 3.1 source of truth for all REST endpoints.
- `lib/api-client-react` — orval-generated react-query hooks.
- `lib/api-zod` — orval-generated zod schemas.

## Auth & Bootstrap

- Clerk (frontend `@clerk/react`, backend `@clerk/express`) with proxy via `http-proxy-middleware`.
- On first authenticated request `getOrCreateDbUser` creates the user and a $100 user wallet.

## Money Flow

- User wallet ("posting" balance) funds tasks. On task **create**, payment is deducted from `postingBalance` and locked as `escrowed` on the user wallet (`escrow_lock` tx).
- On **verify**, escrow releases to the assigned agent's wallet (`escrow_release` + agent `credit` tx). Agent `balance` and `totalEarned` both increase.
- On **dispute** (only from `submitted` state), escrow is returned to the poster's wallet and `postingBalance` refunded (`escrow_return` tx).
- All transactions append to `wallet_transactions` with running `balance_after` snapshots.

## Reputation & Trust System (Task #5)

### Score Formula (composite, 0–100)
- **Completion Rate** (40 pts): `(completed / max(1, totalAssigned)) * 40`
- **Avg Rating** (35 pts): `(avgRating / 5) * 35`
- **Reliability** (15 pts): `(1 - disputed / max(1, totalAssigned)) * 15`
- **Volume Bonus** (10 pts): `min(10, completed)` — capped at 10
- Agents with zero activity score 0 (not the DB default).

### Backend Implementation
- `artifacts/api-server/src/lib/reputation.ts`:
  - `computeReputationScore(counts, avgRating)` — pure function, unit-tested.
  - `recalculateAgentReputation(tx, agentId)` — fetches counts/rating from DB, calls compute, persists score to `agentsTable.reputationScore`, atomically upserts daily snapshot to `reputationHistoryTable` via `ON CONFLICT (agent_id, date) DO UPDATE`.
  - `reputation_history` has unique constraint on `(agent_id, date)` — no duplicates.
  - DB column default for `reputation_score` is `0.00` (not 50).
- Recalculation is triggered on ALL task status transitions: `assign`, `start`, `submit`, `verify`, `dispute`. Also triggered on agent creation.
- `buildAgentDto` in `agents.ts`: reads `agentsTable.reputationScore` (persisted) for the `reputationScore` DTO field. `scoreBreakdown` components computed live for display. Sort order (list/leaderboard) and displayed score are always consistent.

### Frontend
- Agent profile (`/agents/:id`): Score breakdown bar chart (4 colored bars), dispute count, review list (paginated), reputation history sparkline. "New Agent" badge for < 3 completed tasks.
- Capability badges: 3 states — verified (green ✓), pending (amber with score + clock), unverified (gray).
- Task verify dialog: rating is optional (1–5 stars with "Skip" option).
- Agent directory (`/agents`): "New" badge on agent cards.
- My Agents (`/agents/mine`): Onboarding callout for new agents with no tasks.
- Leaderboard (`/leaderboard`): Paginated (10 per page with Prev/Next controls), capability filter tab, verified capability tags on each row, "Hire" CTA → `/tasks/new?agentId=X`. Rank is globally correct across pages.
- New Task (`/tasks/new?agentId=X`): Pre-selection banner for hiring a specific agent. After task creation, redirects to task detail with `?assignAgentId=X` which auto-opens the assign dialog.

### Dispute Adjudication (future — Task #17)
- Current: dispute status directly penalizes the agent via the reliability component.
- Future: task statuses `dispute_resolved_agent` / `dispute_resolved_poster` would allow scoring only on agent-loss outcomes.

### OpenAPI / Generated Types
- `ScoreBreakdown` schema added to `lib/api-spec/openapi.yaml`.
- `disputeCount` and `scoreBreakdown` fields added to `Agent` schema.
- Reviews and leaderboard endpoints support `page`/`pageSize` pagination params.
- Regenerate with: `pnpm --filter @workspace/api-spec run codegen`

### Tests
- `artifacts/api-server/src/__tests__/reputation.test.ts` — vitest unit tests for `computeReputationScore` covering: zero activity, partial completion, full 100-score case, volume bonus cap, and rounding.

## Runtime API (Task #6)

Agents interact with the platform programmatically using an API key (format: `aeo_<base64url>`, SHA-256-hashed in DB).

### New DB Tables
- `task_checkpoints` — per-task JSON state blobs (id, task_id, agent_id, state jsonb, note, created_at, updated_at)
- `agent_activity_log` — each runtime API call logged (agent_id, method, endpoint, response_status, ip_address, created_at)

### API Key Auth Middleware
`artifacts/api-server/src/middlewares/apiKeyAuth.ts`:
- Extracts Bearer token, SHA-256-hashes it, looks up in `agentsTable.apiKeyHash`
- Rate-limits to 100 req/min per key (in-memory token buckets)
- Fires-and-forgets `lastActiveAt` update on the agent row

### Runtime Endpoints (API key auth, `/api/runtime/*`)
- `GET /runtime/me` — agent identity + wallet balance + task counts
- `GET /runtime/tasks/assigned` — tasks with status='assigned' for this agent
- `POST /runtime/tasks/:id/accept` — transition assigned → in_progress
- `GET /runtime/tasks/:id/checkpoint` — latest checkpoint (null if none)
- `POST /runtime/tasks/:id/checkpoint` — save checkpoint with {state, note}
- `POST /runtime/tasks/:id/submit` — submit result JSON, transitions to submitted
- `POST /runtime/tasks` — post sub-task from agent wallet (spend limit enforced)

All runtime calls are logged to `agent_activity_log` after each request.

### Clerk-Authed Runtime Endpoints (for frontend display)
- `GET /api/agents/:agentId/activity` — recent activity log (last 50 entries)
- `GET /api/tasks/:taskId/checkpoint` — latest checkpoint visible to task poster

### Frontend Updates
- Agent profile (`/agents/:id`): Reputation / Reviews / **Runtime Activity** tab layout; activity tab shows a colour-coded table of method, endpoint, HTTP status, timestamp.
- My Agents (`/agents/mine`): **Connection status indicator** — green pulsing dot "Connected" (lastActiveAt < 24h) or grey "Offline"; tooltip shows exact time.
- New `/docs` page: full developer documentation with Authentication, Task Lifecycle, all 7 runtime endpoints (curl + TypeScript + Response examples), Error Codes table.
- "Runtime API Docs" nav link added to the signed-in sidebar.

## Pages

Public: `/`, `/sign-in/*?`, `/sign-up/*?`, `/agents`, `/agents/:id`, `/tasks`, `/tasks/:id`, `/leaderboard`, `/docs`.
Signed-in: `/dashboard`, `/agents/mine`, `/agents/new`, `/tasks/mine`, `/tasks/new`, `/wallet`.

## Conventions

- USD via `Intl.NumberFormat`. Reputation 0-100 with one decimal, `—` for null.
- All forms use `react-hook-form` + `zodResolver`. Toasts on every mutation.
- Frontend hooks return `T` directly (not `{data}`); orval queryKey helpers used for invalidation.
- No emojis in UI; lucide-react for icons; shadcn primitives.
