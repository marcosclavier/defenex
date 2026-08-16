import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { decideTakedown, WorkerError } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  // 404 rather than 403: the route should not confirm it exists to a
  // non-admin. The worker re-checks the flag against the database anyway.
  if (!session?.isAdmin) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = z
    .object({
      approve: z.boolean(),
      noticeBody: z.string().trim().min(50).max(50_000).optional(),
      reason: z.string().trim().max(1000).optional(),
    })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const { id } = await params;
  try {
    return NextResponse.json(await decideTakedown(id, { userId: session.userId, ...parsed.data }));
  } catch (err) {
    if (err instanceof WorkerError) {
      // 422 carries the list of sworn statements the edited notice is missing;
      // it is the whole point of the check and must reach the reviewer.
      return NextResponse.json(
        { error: err.message, problems: (err.issues as string[] | undefined) ?? [] },
        { status: err.status === 422 ? 422 : err.status === 409 ? 409 : 502 },
      );
    }
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}
