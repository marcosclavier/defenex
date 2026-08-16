import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { requestTakedown, WorkerError } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every precondition — verified rights, allowance, no duplicate — is enforced
 * worker-side against the session's user id. This route only carries the
 * refusal back with a status the client can act on.
 */
const REFUSAL_STATUS: Record<string, number> = {
  not_found: 404,
  not_owner: 404,
  no_verified_rights: 409,
  already_requested: 409,
  allowance_exhausted: 402,
};

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    return NextResponse.json(await requestTakedown(id, session.userId));
  } catch (err) {
    if (err instanceof WorkerError) {
      return NextResponse.json(
        { error: err.message, ...(typeof err.issues === "object" && err.issues ? err.issues : {}) },
        { status: REFUSAL_STATUS[err.message] ?? 502 },
      );
    }
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}
