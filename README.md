# Defenex

Automated brand protection: find counterfeit listings, domain squatting, phishing,
and impersonation across the open web — then take them down.

- **`DEFENEX.md`** — product and business design
- **`BUILD.md`** — full 7-milestone build plan
- **This file** — how to run the repo

## Layout

```
apps/web/       Next.js 16 (App Router) → Vercel
apps/worker/    BullMQ + Playwright → Railway (Dockerfile)
packages/core/  detection engine — CSE, classifier, scoring (no web/worker deps)
packages/db/    Drizzle schema + migrations
packages/emails/ React Email templates
packages/shared/ types, zod schemas, constants
```

Workspace packages are consumed **just-in-time as TypeScript source** — no per-package
build step. `apps/web` compiles them via `transpilePackages`; `apps/worker` bundles
them with tsup.

## Setup

```bash
corepack enable
pnpm install
cp .env.example .env      # then fill in values
```

Requires Node >= 22.

## Commands

```bash
pnpm dev             # all apps in watch mode
pnpm typecheck       # tsc --noEmit across the workspace
pnpm test            # vitest
pnpm build           # build everything

pnpm preflight       # check every credential and dependency works
pnpm scan --brand "Acme Tools" --domain acmetools.com   # run the engine from the CLI
pnpm db:generate     # generate a migration from schema changes
pnpm db:migrate      # apply migrations (needs DATABASE_URL)
pnpm db:studio       # browse the database
```

## Environment

See `.env.example` for the full list. Search runs on **YepAPI** (`YEPAPI_API_KEY`),
which serves both SERP queries and the stealth scraper. Google Custom Search is
retained only as a fallback provider and is being discontinued in January 2027.

Run `pnpm preflight` after changing credentials. It verifies the Custom Search API,
Gemini, the browser, and the SSRF guard, and tells you exactly which one is wrong.
Behind an egress-restricted network, set `PREFLIGHT_FETCH_URL` to a permitted host.

## Decisions log

Things that are non-obvious from the code:

- **bullmq/ioredis pinned to 5.x, not 6.x.** Both 6.0 majors are ~2 weeks old and
  bullmq shipped 8 patches in 11 days. The queue is critical infrastructure and 5.x
  covers everything used here. Revisit once 6.x settles.
- **TypeScript 5.9, not 7.x.** TS 7 (native port) is available but the toolchain
  (drizzle-kit, Next, vitest) has had little time against it. Cheap to upgrade later.
- **`allowBuilds` in `pnpm-workspace.yaml`** — pnpm 11 blocks postinstall scripts by
  default. Only packages that genuinely need a native build are allowed;
  `msgpackr-extract` is explicitly denied since its JS fallback is fine.
- **Worker runs on the official Playwright Docker image.** Building Chromium's system
  dependencies onto a bare node image is a day of chasing missing `.so` files.
- **Search sits behind a `SearchProvider` interface.** Google is retiring the
  Custom Search JSON API in January 2027, and YepAPI is a third party. Nothing
  in the engine depends on a specific vendor.
- **Search is billed per call, not per result.** Depth is therefore free
  coverage: `depth: 100` costs the same $0.01 as `depth: 10`. The only cost of
  going deep is latency (~7s vs ~1.4s).
- **The stealth scraper is tier 2, never tier 1.** It costs 3x a search call and
  takes 15-25s, so it fires only where the free browser path was already blocked,
  under a per-scan cap. It returns no screenshot, so `evidenceSource` records
  which findings lack visual evidence — takedown notices need it.
- **`findings` is unique on `(brand_id, url_hash)`.** This is what makes a rescan a
  diff instead of a duplicate pile — upsert bumps `last_seen_at`, and URLs absent for
  two consecutive scans flip to `removed`, which is also the proof a takedown worked.
- **`contacts.consent_basis` is required before any outreach send.** The operator
  sends from Canada, so CASL applies and the *sender* carries the burden of proving
  consent. Appended or pattern-guessed emails do not qualify — see `BUILD.md`.

## Deploy

- **Vercel** → root directory `apps/web`. Commercial use requires the Pro plan.
- **Railway** → Postgres + Redis + a service built from `apps/worker/Dockerfile`.
  Use the private (`.railway.internal`) URLs for `DATABASE_URL` and `REDIS_URL`.
- Run migrations as an explicit deploy step, never from app startup — concurrent
  replicas racing the same migration corrupts state.
