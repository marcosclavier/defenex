import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type IORedis from "ioredis";
import { eq } from "drizzle-orm";
import { getDb, users } from "@defenex/db";

/**
 * Magic-link tokens.
 *
 * Deliberately small and hand-rolled rather than an auth framework: the web app
 * runs on Vercel and cannot reach Postgres, so every adapter callback would be
 * an HTTP hop across the boundary. The surface here is one flow with no
 * passwords and no OAuth, and the properties that matter are explicit:
 *
 *  - 32 random bytes, so the token is not guessable.
 *  - Only a SHA-256 hash is stored, so a Redis dump yields nothing usable.
 *  - 15 minute TTL, enforced by Redis rather than by a comparison we could get
 *    wrong.
 *  - Single use: verification reads and deletes atomically, so a link forwarded
 *    or replayed from a mail scanner cannot be used twice.
 */
const TOKEN_TTL_SECONDS = 15 * 60;

function keyFor(token: string): string {
  return `auth-magic-${createHash("sha256").update(token).digest("hex")}`;
}

export function createAuth(redis: IORedis) {
  return {
    /** Returns the raw token to embed in the emailed link. Never logged. */
    async issue(email: string): Promise<string> {
      const token = randomBytes(32).toString("base64url");
      await redis.set(keyFor(token), email.toLowerCase().trim(), "EX", TOKEN_TTL_SECONDS);
      return token;
    },

    /**
     * Consumes a token and returns the user it belongs to, creating one on
     * first sign-in. Returns null for anything expired, unknown or reused.
     */
    async verify(token: string): Promise<{ id: string; email: string; isAdmin: boolean } | null> {
      if (!token || token.length < 20) return null;

      // GETDEL is atomic: two concurrent verifications cannot both succeed.
      const email = await redis.getdel(keyFor(token));
      if (!email) return null;

      const db = getDb();
      const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
      if (existing) {
        return { id: existing.id, email: existing.email, isAdmin: existing.isAdmin };
      }

      const [created] = await db.insert(users).values({ email }).returning();
      return { id: created!.id, email: created!.email, isAdmin: created!.isAdmin };
    },
  };
}

/** Constant-time string compare for secrets that are not fixed length. */
export function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}
