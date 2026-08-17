# Defenex

Automated brand protection: find counterfeit listings, domain squatting, phishing,
and impersonation across the open web — then take them down.

Product design and the milestone build plan are kept in internal working docs
outside this repository.

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

See `.env.example` for the full list. SERP queries run on **YepAPI**
(`YEPAPI_API_KEY`) with **Serper.dev** (`SERPER_DEV_API_KEY`) behind it as
failover; `SEARCH_PROVIDER` pins a single provider to revert. Google Custom
Search is deprecated, unwired, and is being discontinued in January 2027.

The paid fetch tier — the one that reads pages a headless browser cannot — runs
**spider.cloud** (`SPIDER_CLOUD_API_KEY`) first and falls back to YepAPI where
spider is defeated. `SCAN_FETCH_PROVIDER` is `chain` by default and can pin a
single provider (`spider` or `yepapi`) to revert without a deploy.

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
- **Search is billed per call, not per result** — on the primary. Depth is
  therefore free coverage there: `depth: 100` costs the same $0.01 as
  `depth: 10`, and the only cost of going deep is latency. This is *not* true of
  the failover: Serper accepts `num` and ignores it, returning ~10 organic
  results per call and billing each page, so depth costs money whenever the
  chain has fallen through.
- **A search outage degrades a scan; it does not delete one.** A failed query
  costs its own results and nothing else, and the scan is recorded `partial`
  with the count of what it missed — telling a customer "nothing found" after
  covering a third of the ground would be false. When every provider is
  unreachable, a cached SERP past its TTL is served rather than nothing.
- **The search cache is keyed on the question, not on who was asked.** That is
  what makes a warm cache an outage buffer: a query the primary cached
  yesterday is served today without buying it again from the fallback. It is
  only safe because both providers front the same index; a provider with a
  different index would need its own namespace.
- **The failover sees less than the primary.** Serper returns only organic
  results — no ad placements, no product carousels, no malicious flag — so a
  fallback scan scores without signals the primary supplies. `scans.search_provider`
  records which one answered, because a thin report needs an explanation.
- **The paid scraper is tier 2, never tier 1.** It fires only where the free
  browser path was already blocked, under a per-scan cap. It returns no
  screenshot of its own, so `evidenceSource` records which findings lack visual
  evidence — takedown notices need it.
- **The paid tier is a chain, because neither provider wins outright.** Measured
  over six marketplace pages: spider reads DHgate, which YepAPI and our own
  browser both get a 403 from, and costs a fortieth as much; YepAPI reads Etsy,
  which spider gets a consistent 403 from. Ordered price-ascending, the chain
  read 6/6 for $0.0051 where spider alone read 5/6 and YepAPI alone cost $0.12 —
  the expensive hop only fires where the cheap one failed. Both providers run
  their output through the same `htmlToText`, so switching changes who fetched a
  page and nothing about what the classifier reads; otherwise a detection change
  could not be attributed to the swap rather than to a different extractor.
- **Evidence capture has a third tier for sites that block us outright.** The
  markup is fetched through the proxy and rendered locally with an injected
  `<base>`. The manifest records `captureMethod`, because a screenshot of markup
  the origin served is not a photograph of the live page and the two must not be
  presented as the same claim.
- **`findings` is unique on `(brand_id, url_hash)`.** This is what makes a rescan a
  diff instead of a duplicate pile — upsert bumps `last_seen_at`, and URLs absent for
  two consecutive scans flip to `removed`, which is also the proof a takedown worked.
- **`contacts.consent_basis` is required before any outreach send.** The operator
  sends from Canada, so CASL applies and the *sender* carries the burden of proving
  consent. Appended or pattern-guessed emails do not qualify.

## Deploy

```
Vercel (defenex-web)          Railway (desirable-simplicity)
  apps/web                      defenex-worker  [public HTTPS]
      |                             |  private network
      +---- HTTPS + shared secret ->+---> Postgres   (never public)
                                    +---> Redis      (never public)
```

- **Vercel** → root directory `apps/web`. Commercial use requires the Pro plan.
  It holds only `WORKER_API_URL`, `WORKER_API_SECRET` and `NEXT_PUBLIC_APP_URL`.
- **Railway** → Postgres + Redis + a worker built from `apps/worker/Dockerfile`,
  configured by `railway.json`. The databases keep private
  (`.railway.internal`) URLs, which Vercel cannot resolve by design.
- **The web app never talks to Postgres or Redis directly.** It calls the worker
  over HTTPS with a shared secret. This keeps both databases off the public
  internet and avoids serverless connection-pool exhaustion, since only the
  long-lived worker holds a pool.
- Migrations run as `preDeployCommand` in `railway.json` — never from app
  startup, where concurrent replicas would race the same migration.

**Billing.** `pnpm stripe:setup` builds the catalogue; `--test` targets test mode
and `--apply` writes. Price ids differ per mode, so Vercel production carries the
live ids and preview/development carry the test ids. Lookup is keyed on a
`defenex_plan` metadata field, not on product name, because this Stripe account
also serves helloranked and PureStudio.

**Do not enable Railway's Vercel variable sync.** It mirrors every Railway
variable into Vercel, including database passwords and the YepAPI, Gemini and
Apify keys, none of which the web app needs.
