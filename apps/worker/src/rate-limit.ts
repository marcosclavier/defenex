import IORedis from "ioredis";

/**
 * Rate limiting lives here rather than on Vercel because the worker owns Redis.
 *
 * Two independent limits, because they stop different things: the per-domain
 * limit stops the same brand being rescanned all day (each scan costs real
 * money in search and stealth calls), and the per-IP limit stops one visitor
 * enumerating many brands.
 */
export interface LimitResult {
  allowed: boolean;
  scope?: "domain" | "ip";
  retryAfterSeconds?: number;
}

const DOMAIN_WINDOW_SECONDS = 24 * 60 * 60;
const IP_WINDOW_SECONDS = 24 * 60 * 60;
const IP_MAX_PER_WINDOW = 5;

export function createRateLimiter(redis: IORedis) {
  return async function check(domain: string, ip: string): Promise<LimitResult> {
    const domainKey = `rl-domain-${domain.toLowerCase()}`;
    const ipKey = `rl-ip-${ip}`;

    // One scan per domain per day: a second request returns the cached report
    // rather than paying to rediscover the same listings.
    const domainCount = await redis.incr(domainKey);
    if (domainCount === 1) await redis.expire(domainKey, DOMAIN_WINDOW_SECONDS);
    if (domainCount > 1) {
      return { allowed: false, scope: "domain", retryAfterSeconds: await redis.ttl(domainKey) };
    }

    if (ip && ip !== "unknown") {
      const ipCount = await redis.incr(ipKey);
      if (ipCount === 1) await redis.expire(ipKey, IP_WINDOW_SECONDS);
      if (ipCount > IP_MAX_PER_WINDOW) {
        // Release the domain slot we just claimed, or a blocked visitor would
        // lock that brand out for everyone else for a day.
        await redis.del(domainKey);
        return { allowed: false, scope: "ip", retryAfterSeconds: await redis.ttl(ipKey) };
      }
    }

    return { allowed: true };
  };
}
