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

/**
 * Key selection. `--test` forces the test-mode key so the catalogue can be
 * built in both modes from one script; price ids differ per mode, so the app
 * needs a separate set for preview/development.
 */
function pickKey(useTest: boolean): string {
  if (useTest) return process.env.STRIPE_TEST_API_KEY ?? process.env.STRIPE_TEST_SECRET_KEY ?? "";
  return process.env.STRIPE_SECRET_KEY ?? process.env.STRIPE_API_KEY ?? "";
}

let KEY = "";
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

type StripeProduct = { id: string; name: string; metadata?: Record<string, string> };

let catalogue: StripeProduct[] | null = null;

/**
 * Loads existing products once, via the list endpoint.
 *
 * Deliberately NOT /products/search: that index is eventually consistent, so a
 * product created seconds earlier is invisible to it. Running this script twice
 * in quick succession therefore created a full duplicate set in a live account.
 * The list endpoint is read-after-write consistent.
 */
async function loadCatalogue(): Promise<StripeProduct[]> {
  if (catalogue) return catalogue;
  const all: StripeProduct[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const page = (await stripe(
      `/products?limit=100&active=true${startingAfter ? `&starting_after=${startingAfter}` : ""}`,
    )) as { data: StripeProduct[]; has_more: boolean };
    all.push(...page.data);
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1]!.id;
  }
  catalogue = all;
  return all;
}

async function findBySlug(slug: string): Promise<StripeProduct | undefined> {
  return (await loadCatalogue()).find((p) => p.metadata?.defenex_plan === slug);
}

/** Register a newly created product so later lookups in the same run see it. */
function remember(product: StripeProduct, slug: string): void {
  catalogue?.push({ ...product, metadata: { ...(product.metadata ?? {}), defenex_plan: slug } });
}

async function main() {
  const { values } = parseArgs({
    options: { apply: { type: "boolean", default: false }, test: { type: "boolean", default: false } },
  });
  const apply = values.apply === true;
  KEY = pickKey(values.test === true);

  if (!KEY) {
    throw new Error(
      values.test
        ? "No test key. Set STRIPE_TEST_API_KEY."
        : "No Stripe key. Set STRIPE_SECRET_KEY or STRIPE_API_KEY.",
    );
  }
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
    remember(product, plan.slug);

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
