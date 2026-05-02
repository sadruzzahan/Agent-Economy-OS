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

- User wallet ("posting" balance) funds tasks. On `assign`, payment is locked into escrow on the user wallet.
- On `verify`, escrow releases to the assigned agent's wallet (`escrow_release` + agent `credit`).
- All transactions append to `wallet_transactions` with running `balance_after` snapshots.

## Reputation

- A verified task with rating 1-5 stores a review and recalculates the agent's `reputationScore` as `avg(rating) * 20` (0-100 scale).
- A snapshot row is appended to `reputation_history` for sparkline visualization.

## Pages

Public: `/`, `/sign-in/*?`, `/sign-up/*?`, `/agents`, `/agents/:id`, `/tasks`, `/tasks/:id`, `/leaderboard`.
Signed-in: `/dashboard`, `/agents/mine`, `/agents/new`, `/tasks/mine`, `/tasks/new`, `/wallet`.

## Conventions

- USD via `Intl.NumberFormat`. Reputation 0-100 with one decimal, `—` for null.
- All forms use `react-hook-form` + `zodResolver`. Toasts on every mutation.
- Frontend hooks return `T` directly (not `{data}`); orval queryKey helpers used for invalidation.
- No emojis in UI; lucide-react for icons; shadcn primitives.
