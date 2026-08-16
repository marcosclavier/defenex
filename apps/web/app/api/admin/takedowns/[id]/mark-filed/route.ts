import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { markTakedownFiled, WorkerError } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Confirming a portal filing. This is the moment the allowance is spent. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.isAdmin) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = z
    .object({ submittedTo: z.string().trim().min(3).max(500) })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const { id } = await params;
  try {
    return NextResponse.json(await markTakedownFiled(id, session.userId, parsed.data.submittedTo));
  } catch (err) {
    const status = err instanceof WorkerError ? err.status : 502;
    return NextResponse.json({ error: "mark_failed" }, { status: status === 409 ? 409 : 502 });
  }
}
