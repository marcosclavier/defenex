# Official Playwright image ships Chromium plus every system library it needs.
# Building from a bare node image means chasing missing .so files for a day.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

# Copy manifests first so dependency layers cache across code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/emails/package.json ./packages/emails/
COPY apps/worker/package.json ./apps/worker/

RUN pnpm install --frozen-lockfile

COPY packages ./packages
COPY apps/worker ./apps/worker

RUN pnpm --filter @defenex/worker build

EXPOSE 3001
CMD ["node", "apps/worker/dist/index.js"]
