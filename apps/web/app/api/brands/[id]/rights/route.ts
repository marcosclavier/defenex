import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { submitRights, listRights, WorkerError } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    return NextResponse.json(await listRights(id));
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const parsed = z
    .object({
      regNumber: z.string().trim().min(4).max(20),
      jurisdiction: z.string().trim().min(2).max(8).default("US"),
    })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  try {
    // Ownership is checked worker-side against the session's user id.
    return NextResponse.json(await submitRights(id, { userId: session.userId, ...parsed.data }));
  } catch (err) {
    const status = err instanceof WorkerError ? err.status : 502;
    return NextResponse.json({ error: "submit_failed" }, { status: status === 404 ? 404 : 502 });
  }
}
