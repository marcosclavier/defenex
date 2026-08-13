import { NextResponse } from "next/server";
import { z } from "zod";
import { startScan, WorkerError } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  brand: z.string().trim().min(2).max(100),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    // Accept a pasted URL and reduce it to a bare host before validating.
    .transform((v) => v.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "")
    .pipe(z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, "Enter a domain like acme.com")),
  industry: z.enum(["fashion", "electronics", "software", "cosmetics", "supplements", "generic"]),
  email: z.email("Enter a valid email address").optional().or(z.literal("")),
  allowlistDomains: z.array(z.string()).max(50).optional(),
});

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_request",
        fields: Object.fromEntries(
          parsed.error.issues.map((i) => [i.path.join(".") || "form", i.message]),
        ),
      },
      { status: 400 },
    );
  }

  const { email, ...rest } = parsed.data;

  try {
    const result = await startScan({ ...rest, ...(email ? { email } : {}) }, clientIp(req));
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    if (err instanceof WorkerError) {
      if (err.status === 429) {
        return NextResponse.json(
          { error: "rate_limited", message: "That domain was scanned recently. Try again tomorrow." },
          { status: 429 },
        );
      }
      // Never surface the worker's internals to the browser.
      return NextResponse.json({ error: "scan_failed" }, { status: err.status >= 500 ? 502 : err.status });
    }
    return NextResponse.json({ error: "scan_failed" }, { status: 502 });
  }
}
