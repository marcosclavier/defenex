/** Catalogue mirror. Price ids come from `pnpm stripe:setup`. */
export type PlanSlug = "free" | "monitor" | "protect" | "managed";

export interface Plan {
  slug: Exclude<PlanSlug, "free">;
  name: string;
  blurb: string;
  monthly: number;
  yearly: number;
  includedEnforcements: number;
  features: string[];
  priceEnv: { monthly: string; yearly: string };
}

export const PLANS: Plan[] = [
  {
    slug: "monitor",
    name: "Monitor",
    blurb: "Know the moment something new appears.",
    monthly: 149,
    yearly: 1490,
    includedEnforcements: 0,
    features: [
      "Weekly rescans of every brand",
      "Alerts on new findings only, never repeats",
      "Full evidence and screenshots",
      "Enforcements at $195 each",
    ],
    priceEnv: { monthly: "STRIPE_PRICE_MONITOR_MONTHLY", yearly: "STRIPE_PRICE_MONITOR_YEARLY" },
  },
  {
    slug: "protect",
    name: "Protect",
    blurb: "Find them daily, and start removing them.",
    monthly: 599,
    yearly: 5990,
    includedEnforcements: 10,
    features: [
      "Daily rescans",
      "10 enforcements a month, then $85 each",
      "Evidence bundles prepared for filing",
      "Removal tracked to resolution",
    ],
    priceEnv: { monthly: "STRIPE_PRICE_PROTECT_MONTHLY", yearly: "STRIPE_PRICE_PROTECT_YEARLY" },
  },
  {
    slug: "managed",
    name: "Managed",
    blurb: "We run enforcement for you.",
    monthly: 2500,
    yearly: 25000,
    includedEnforcements: 50,
    features: [
      "Everything in Protect",
      "50 enforcements a month",
      "Reviewed and filed by our team",
      "Escalation support for UDRP and counsel",
    ],
    priceEnv: { monthly: "STRIPE_PRICE_MANAGED_MONTHLY", yearly: "STRIPE_PRICE_MANAGED_YEARLY" },
  },
];

/** Resolve a Stripe price id back to the plan it grants. */
export function planForPriceId(priceId: string): { slug: PlanSlug; included: number } {
  for (const plan of PLANS) {
    for (const key of [plan.priceEnv.monthly, plan.priceEnv.yearly]) {
      if (process.env[key] && process.env[key] === priceId) {
        return { slug: plan.slug, included: plan.includedEnforcements };
      }
    }
  }
  // An unrecognised price must not silently grant a paid plan.
  return { slug: "free", included: 0 };
}
