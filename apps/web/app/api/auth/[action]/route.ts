import { NextResponse } from "next/server";
import { z } from "zod";
import { requestMagicLink } from "@/lib/worker";
import { destroySession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;

  if (action === "request") {
    const body = await req.json().catch(() => null);
    const parsed = z.object({ email: z.email() }).safeParse(body);
    // Same response either way — never reveal whether an address is known.
    if (parsed.success) {
      await requestMagicLink(parsed.data.email, clientIp(req)).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "signout") {
    await destroySession();
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
