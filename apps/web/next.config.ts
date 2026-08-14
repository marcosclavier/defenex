import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages are consumed as TypeScript source (no build step),
  // so Next has to compile them itself.
  transpilePackages: [
    "@defenex/core",
    "@defenex/db",
    "@defenex/emails",
    "@defenex/shared",
  ],
  // Playwright, BullMQ and pg drivers must never be bundled into the client.
  serverExternalPackages: ["playwright", "bullmq", "ioredis", "postgres"],
  /**
   * Canonical host is the apex. Enforced in code rather than in a dashboard
   * setting so the behaviour lives with the app and cannot silently differ
   * between environments — and so www serves a redirect rather than a second
   * copy of the site at a second hostname.
   */
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.defenex.com" }],
        destination: "https://defenex.com/:path*",
        permanent: true,
      },
    ];
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default config;
