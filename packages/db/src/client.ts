import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

/**
 * `@opentelemetry/api` is a dependency of this package and is imported nowhere.
 * It is not dead weight: drizzle-orm declares it as an optional peer, so a
 * consumer that has it (the worker, via @sentry/node) resolves a different
 * drizzle instance from one that does not. Two instances means two separate
 * declarations of the same private types, and `packages/db` and `apps/worker`
 * stop agreeing about what an `SQL<>` is. Declaring it here keeps every
 * dependent on one copy. Removing it breaks the worker's typecheck.
 */

let client: postgres.Sql | undefined;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | undefined;

/**
 * Lazily-created singleton. Serverless invocations reuse the connection across
 * warm starts; the worker holds one pool for its lifetime.
 */
export function getDb() {
  if (!dbInstance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    client = postgres(url, { max: 10, idle_timeout: 20, prepare: false });
    dbInstance = drizzle(client, { schema });
  }
  return dbInstance;
}

export async function closeDb() {
  await client?.end();
  client = undefined;
  dbInstance = undefined;
}
