import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { stripe } from "@/lib/stripe";
import { PLANS } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  slug: z.enum(["monitor", "protect", "managed"]),
  cadence: z.enum(["monthly", "yearly"]),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const plan = PLANS.find((p) => p.slug === parsed.data.slug);
  if (!plan) return NextResponse.json({ error: "unknown_plan" }, { status: 400 });

  const priceId = process.env[plan.priceEnv[parsed.data.cadence]];
  if (!priceId) {
    // Better a clear failure than a checkout for the wrong amount.
    return NextResponse.json({ error: "price_not_configured" }, { status: 500 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://defenex.com";

  try {
    const checkout = await stripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: session.email,
      // Carried through to the webhook, which is the only place entitlements
      // are granted — never on the redirect back, which a user can forge.
      client_reference_id: session.userId,
      metadata: { defenex_user_id: session.userId, defenex_plan: plan.slug },
      subscription_data: {
        metadata: { defenex_user_id: session.userId, defenex_plan: plan.slug },
      },
      success_url: `${appUrl}/dashboard?checkout=complete`,
      cancel_url: `${appUrl}/pricing`,
      allow_promotion_codes: true,
    });

    return NextResponse.json({ url: checkout.url });
  } catch {
    return NextResponse.json({ error: "checkout_failed" }, { status: 502 });
  }
}
