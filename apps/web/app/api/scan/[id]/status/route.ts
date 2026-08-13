import { NextResponse } from "next/server";
import { getScanStatus, WorkerError } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    return NextResponse.json(await getScanStatus(id));
  } catch (err) {
    const status = err instanceof WorkerError && err.status === 404 ? 404 : 502;
    return NextResponse.json({ error: status === 404 ? "not_found" : "unavailable" }, { status });
  }
}
