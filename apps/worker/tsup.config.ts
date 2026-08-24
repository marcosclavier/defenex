import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

/**
 * Every third-party package must stay external; only workspace code is bundled.
 *
 * Collected from the manifests rather than hard-coded so a new dependency in
 * any @defenex package cannot silently get bundled. Two failures motivated this:
 *
 *  - Left external, the workspace packages break at runtime. They are TypeScript
 *    source whose relative imports carry `.js` specifiers (correct under
 *    `moduleResolution: "Bundler"`), so Node's type-stripping loads the `.ts`
 *    file and then cannot resolve `./schema.js` — nothing emits those files.
 *  - Bundled, third-party CJS breaks. google-auth-library, reached through
 *    @google/genai, does a dynamic `require("child_process")` that esbuild
 *    cannot represent in an ESM bundle.
 */
function dependenciesOf(path: string): string[] {
  const pkg = JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  return Object.keys(pkg.dependencies ?? {}).filter((n) => !n.startsWith("@defenex/"));
}

/**
 * Every external must also be installed next to the bundle, and only the
 * worker's own manifest puts it there.
 *
 * pnpm keeps each package's dependencies under its own `node_modules`, so a
 * package that only `@defenex/core` depends on does not exist anywhere Node
 * will look from `apps/worker/dist/`. Marked external and undeclared, it builds
 * clean, passes CI, and then throws ERR_MODULE_NOT_FOUND on boot — which is how
 * `fflate` reached a Railway healthcheck. Bundling it instead is not the
 * alternative: see the note above on third-party CJS.
 *
 * Failing here puts the error in `pnpm build`, where CI already runs it.
 */
function thirdPartyDeps(): string[] {
  const own = new Set(dependenciesOf("package.json"));
  const workspace = ["core", "db", "emails", "shared"].flatMap((p) =>
    dependenciesOf(`../../packages/${p}/package.json`),
  );

  const undeclared = [...new Set(workspace)].filter((n) => !own.has(n)).sort();
  if (undeclared.length > 0) {
    throw new Error(
      `apps/worker/package.json must depend on every package the bundle leaves external, ` +
        `or Node cannot resolve it at runtime. Missing: ${undeclared.join(", ")}`,
    );
  }

  return [...own];
}

const external = thirdPartyDeps();

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  sourcemap: true,
  noExternal: [/^@defenex\//],
  // Subpath imports (e.g. drizzle-orm/pg-core) need the prefix form too.
  external: [...external, ...external.map((n) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`))],
});
