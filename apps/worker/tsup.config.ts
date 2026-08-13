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
function thirdPartyDeps(): string[] {
  const manifests = [
    "package.json",
    "../../packages/core/package.json",
    "../../packages/db/package.json",
    "../../packages/emails/package.json",
    "../../packages/shared/package.json",
  ];
  const names = new Set<string>();
  for (const path of manifests) {
    const pkg = JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      if (!name.startsWith("@defenex/")) names.add(name);
    }
  }
  return [...names];
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
