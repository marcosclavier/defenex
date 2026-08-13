import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { claimBrand, WorkerError } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = z
    .object({
      domain: z
        .string()
        .trim()
        .toLowerCase()
        .transform((v) => v.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? ""),
    })
    .safeParse(body);

  if (!parsed.success || !parsed.data.domain) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    // The user id comes from the signed session, never from the request body.
    return NextResponse.json(await claimBrand(parsed.data.domain, session.userId));
  } catch (err) {
    const status = err instanceof WorkerError ? err.status : 502;
    const code = err instanceof WorkerError ? err.message : "claim_failed";
    return NextResponse.json({ error: code }, { status: status === 502 ? 502 : status });
  }
}
