/**
 * Creates the Defenex product catalogue in Stripe. Idempotent: re-running
 * reconciles rather than duplicating.
 *
 *   pnpm stripe:setup            # dry run, prints the plan
 *   pnpm stripe:setup --apply    # writes
 *
 * Reads STRIPE_SECRET_KEY if set, otherwise STRIPE_API_KEY. Use a test key
 * (sk_test_…) while building M4 and create the live catalogue at launch: this
 * account is shared with another product line, and a live key means a mistake
 * is visible to real customers.
 *
 * Every product is looked up by the `defenex_plan` metadata key rather than by
 * name, so renaming a plan in the dashboard does not cause a duplicate here.
 */
import { parseArgs } from "node:util";

process.loadEnvFile(new URL("../.env", import.meta.url).pathname);

const KEY = process.env.STRIPE_SECRET_KEY ?? process.env.STRIPE_API_KEY ?? "";
const API = "https://api.stripe.com/v1";

interface Plan {
  slug: string;
  name: string;
  description: string;
  /** Cents. Recurring unless `oneOff`. */
  monthly?: number;
  yearly?: number;
  oneOff?: number;
  /** Enforcements included per month; metered overage is priced separately. */
  included?: number;
}

const PLANS: Plan[] = [
  {
    slug: "monitor",
    name: "Defenex Monitor",
    description: "Weekly rescans with alerts on new findings only.",
    monthly: 14_900,
    yearly: 149_000, // ten months
    included: 0,
  },
  {
    slug: "protect",
    name: "Defenex Protect",
    description: "Daily rescans plus 10 enforcements a month, then $85 each.",
    monthly: 59_900,
    yearly: 599_000,
    included: 10,
  },
  {
    slug: "managed",
    name: "Defenex Managed",
    description: "50 enforcements a month, review SLA and escalation support.",
    monthly: 250_000,
    yearly: 2_500_000,
    included: 50,
  },
  {
    slug: "enforcement-overage",
    name: "Defenex enforcement (additional)",
    description: "One enforcement beyond a plan's monthly allowance.",
    oneOff: 8_500,
  },
  {
    slug: "enforcement-single",
    name: "Defenex enforcement (single)",
    description: "One enforcement without a subscription.",
    oneOff: 19_500,
  },
];

async function stripe(path: string, body?: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${KEY}`,
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(body ? { body: new URLSearchParams(body).toString() } : {}),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = json.error as { message?: string; type?: string } | undefined;
    throw new Error(`${res.status} ${err?.type ?? ""}: ${err?.message ?? "unknown"}`);
  }
  return json;
}

async function findBySlug(slug: string) {
  const r = (await stripe(
    `/products/search?query=${encodeURIComponent(`metadata['defenex_plan']:'${slug}'`)}`,
  )) as { data?: Array<{ id: string; name: string }> };
  return r.data?.[0];
}

async function main() {
  const { values } = parseArgs({ options: { apply: { type: "boolean", default: false } } });
  const apply = values.apply === true;

  if (!KEY) throw new Error("No Stripe key. Set STRIPE_SECRET_KEY or STRIPE_API_KEY.");
  const mode = KEY.includes("_live_") ? "LIVE" : "TEST";
  console.log(`Stripe mode: ${mode}${apply ? "" : "   (dry run — pass --apply to write)"}`);
  if (mode === "LIVE" && apply) {
    console.log("!! Writing to a LIVE account. This catalogue will be visible to real customers.\n");
  }

  const env: string[] = [];

  for (const plan of PLANS) {
    const existing = await findBySlug(plan.slug);
    if (existing) {
      console.log(`  = ${plan.name} (exists: ${existing.id})`);
      env.push(`STRIPE_PRODUCT_${plan.slug.toUpperCase().replace(/-/g, "_")}=${existing.id}`);
      continue;
    }
    if (!apply) {
      console.log(`  + ${plan.name} — would create`);
      continue;
    }

    const product = (await stripe("/products", {
      name: plan.name,
      description: plan.description,
      "metadata[defenex_plan]": plan.slug,
      ...(plan.included !== undefined ? { "metadata[included_enforcements]": String(plan.included) } : {}),
    })) as { id: string };

    const prices: string[] = [];
    for (const [label, amount, interval] of [
      ["monthly", plan.monthly, "month"],
      ["yearly", plan.yearly, "year"],
      ["once", plan.oneOff, null],
    ] as const) {
      if (!amount) continue;
      const price = (await stripe("/prices", {
        product: product.id,
        currency: "usd",
        unit_amount: String(amount),
        "metadata[defenex_plan]": plan.slug,
        "metadata[defenex_cadence]": label,
        ...(interval ? { "recurring[interval]": interval } : {}),
      })) as { id: string };
      prices.push(`${label}=${price.id}`);
      env.push(`STRIPE_PRICE_${plan.slug.toUpperCase().replace(/-/g, "_")}_${label.toUpperCase()}=${price.id}`);
    }
    console.log(`  + ${plan.name} — ${product.id} [${prices.join(" ")}]`);
  }

  if (env.length) {
    console.log("\nAdd to .env and the Vercel project:\n");
    console.log(env.join("\n"));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
