import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { planForPriceId, type PlanSlug } from "@/lib/plans";
import { syncBilling } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe is the source of truth; this mirrors it into our own tables.
 *
 * Entitlements are granted here and nowhere else. The success_url redirect is
 * user-controllable, so treating it as proof of payment would let anyone grant
 * themselves a plan by visiting a URL.
 */
export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) {
    return NextResponse.json({ error: "not_configured" }, { status: 400 });
  }

  // Signature verification needs the raw body, not parsed JSON.
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, signature, secret);
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        const userId = s.client_reference_id ?? s.metadata?.defenex_user_id;
        if (userId && s.subscription) {
          const sub = await stripe().subscriptions.retrieve(String(s.subscription));
          await applySubscription(event.id, event.type, userId, sub);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object;
        const userId = sub.metadata?.defenex_user_id;
        if (userId) await applySubscription(event.id, event.type, userId, sub);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const userId = sub.metadata?.defenex_user_id;
        if (userId) {
          await syncBilling({
            eventId: event.id,
            eventType: event.type,
            userId,
            stripeCustomerId: String(sub.customer),
            stripeSubscriptionId: sub.id,
            plan: "free",
            status: "canceled",
            currentPeriodEnd: null,
            enforcementsIncluded: 0,
          });
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice & { subscription?: string };
        if (invoice.subscription) {
          const sub = await stripe().subscriptions.retrieve(String(invoice.subscription));
          const userId = sub.metadata?.defenex_user_id;
          // Access is not revoked here — Stripe's dunning runs first, and
          // cutting a paying customer off on a single failed card is hostile.
          if (userId) await applySubscription(event.id, event.type, userId, sub);
        }
        break;
      }

      default:
        break;
    }
  } catch {
    // A 500 makes Stripe retry, which is what we want for a transient failure.
    return NextResponse.json({ error: "sync_failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function applySubscription(
  eventId: string,
  eventType: string,
  userId: string,
  sub: Stripe.Subscription,
) {
  const priceId = sub.items.data[0]?.price?.id ?? "";
  const { slug, included } = planForPriceId(priceId);
  const item = sub.items.data[0];

  await syncBilling({
    eventId,
    eventType,
    userId,
    stripeCustomerId: String(sub.customer),
    stripeSubscriptionId: sub.id,
    plan: sub.status === "active" || sub.status === "trialing" ? slug : ("free" as PlanSlug),
    status: sub.status,
    currentPeriodEnd: item?.current_period_end
      ? new Date(item.current_period_end * 1000).toISOString()
      : null,
    enforcementsIncluded: included,
  });
}
