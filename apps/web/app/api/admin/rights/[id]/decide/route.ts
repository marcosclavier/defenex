import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { decideRights, WorkerError } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  // 404 rather than 403, so the route is not discoverable. The worker
  // re-checks the admin flag against the database regardless.
  if (!session?.isAdmin) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = z
    .object({ verified: z.boolean(), reason: z.string().trim().max(500).optional() })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const { id } = await params;
  try {
    return NextResponse.json(
      await decideRights(id, session.userId, parsed.data.verified, parsed.data.reason),
    );
  } catch (err) {
    const status = err instanceof WorkerError ? err.status : 502;
    return NextResponse.json({ error: "decide_failed" }, { status: status === 404 ? 404 : 502 });
  }
}
