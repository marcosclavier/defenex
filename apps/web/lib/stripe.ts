import "server-only";
import Stripe from "stripe";

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY ?? process.env.STRIPE_API_KEY;
    if (!key) throw new Error("No Stripe key configured");
    client = new Stripe(key);
  }
  return client;
}

export function isLiveMode(): boolean {
  const key = process.env.STRIPE_SECRET_KEY ?? process.env.STRIPE_API_KEY ?? "";
  return key.includes("_live_");
}
