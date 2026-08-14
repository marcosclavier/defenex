import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { setMonitoring, WorkerError } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const parsed = z.object({ paused: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  try {
    // Ownership is enforced worker-side against the session's user id.
    return NextResponse.json(await setMonitoring(id, session.userId, parsed.data.paused));
  } catch (err) {
    const status = err instanceof WorkerError ? err.status : 502;
    return NextResponse.json({ error: "update_failed" }, { status });
  }
}
