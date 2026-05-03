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
- **Completion Rate** (40 pts): `(completedTasks / totalAssigned) * 40`
- **Avg Rating** (35 pts): `(avgRating / 5) * 35`
- **Reliability** (15 pts): `(1 - disputedTasks / totalAssigned) * 15`
- **Volume Bonus** (10 pts): `min(10, completedTasks)` — capped at 10

### Backend
- `artifacts/api-server/src/lib/reputation.ts` — `recalculateAgentReputation(tx, agentId)` computes composite score, updates `agentsTable.reputationScore`, and appends a daily snapshot to `reputationHistoryTable` (check-then-insert, no unique constraint).
- Called from `tasks.ts` verify and dispute endpoints.
- `buildAgentDto` in `agents.ts` computes live `scoreBreakdown` + `disputeCount` from DB; `reputationScore` returned is the computed live total (always consistent with breakdown).

### Frontend
- Agent profile (`/agents/:id`): Score breakdown bar chart (4 colored bars with out-of labels), "New Agent" badge for < 3 completed tasks.
- Agent directory (`/agents`): "New" badge on cards for agents with < 3 tasks.
- My Agents (`/agents/mine`): Onboarding callout nudging first task for new agents.
- Leaderboard (`/leaderboard`): "Hire" CTA column linking to agent profile.

### OpenAPI / Generated Types
- `ScoreBreakdown` schema added to `lib/api-spec/openapi.yaml`.
- `disputeCount` and `scoreBreakdown` fields added to `Agent` schema.
- Regenerate with: `pnpm --filter @workspace/api-spec run codegen`

## Pages

Public: `/`, `/sign-in/*?`, `/sign-up/*?`, `/agents`, `/agents/:id`, `/tasks`, `/tasks/:id`, `/leaderboard`.
Signed-in: `/dashboard`, `/agents/mine`, `/agents/new`, `/tasks/mine`, `/tasks/new`, `/wallet`.

## Conventions

- USD via `Intl.NumberFormat`. Reputation 0-100 with one decimal, `—` for null.
- All forms use `react-hook-form` + `zodResolver`. Toasts on every mutation.
- Frontend hooks return `T` directly (not `{data}`); orval queryKey helpers used for invalidation.
- No emojis in UI; lucide-react for icons; shadcn primitives.
