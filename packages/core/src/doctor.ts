/**
 * Preflight check for every external dependency the engine needs.
 * Run after changing credentials: `pnpm doctor`
 */
import { GoogleGenAI } from "@google/genai";
import { YepApiClient } from "./search/yepapi.js";
import { SerperClient } from "./search/serper.js";
import type { SearchProvider } from "./search/types.js";
import { GeminiClassifier } from "./classify/gemini.js";
import { PageFetcher } from "./enrich/fetch.js";
import { SpiderScraper } from "./enrich/spider.js";
import { SearchConfigError } from "./errors.js";
import type { EnrichedResult, ScanInput } from "@defenex/shared";

try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url).pathname);
} catch {
  /* environment may already be populated */
}

const C = { reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m" };
const PASS = `${C.green}PASS${C.reset}`;
const FAIL = `${C.red}FAIL${C.reset}`;
const WARN = `${C.yellow}WARN${C.reset}`;

let failures = 0;

function report(name: string, ok: boolean | "warn", detail = ""): void {
  const tag = ok === "warn" ? WARN : ok ? PASS : FAIL;
  if (ok === false) failures++;
  console.log(`  ${tag}  ${name}${detail ? `\n        ${C.dim}${detail}${C.reset}` : ""}`);
}

async function checkEnv(): Promise<void> {
  console.log(`\n${C.bold}Environment${C.reset}`);
  const required = ["YEPAPI_API_KEY", "GEMINI_API_KEY"];
  const optional = [
    "SPIDER_CLOUD_API_KEY", "SERPER_DEV_API_KEY", "DATABASE_URL", "REDIS_URL", "RESEND_API_KEY", "APIFY_API_KEY",
    "CLOUDFLARE_BUCKET_S3_ENDPOINT", "CLOUDFLARE_BUCKET_S3_ACCESS_KEY_ID",
    "CLOUDFLARE_BUCKET_S3_SECRET_ACCESS_KEY",
  ];

  for (const key of required) {
    report(key, Boolean(process.env[key]), process.env[key] ? "" : "required by the detection engine");
  }
  for (const key of optional) {
    if (!process.env[key]) report(key, "warn", "not set — needed by a later milestone");
    else report(key, true);
  }
}

/**
 * The paid fetch tier, checked against a site that actually refuses a headless
 * browser. Reaching example.com proves nothing here — the entire reason this
 * tier exists is the pages that block us.
 */
async function checkScraper(): Promise<void> {
  const key = process.env.SPIDER_CLOUD_API_KEY;
  console.log(`\n${C.bold}Paid fetch tier (spider.cloud)${C.reset}`);
  if (!key) {
    report("SPIDER_CLOUD_API_KEY", "warn", "not set — the scanner falls back to the YepAPI stealth tier");
    return;
  }

  try {
    const scraper = new SpiderScraper({ apiKey: key });
    const out = await scraper.scrape("https://www.dhgate.com/wholesale/replica+yeti+cooler.html");
    report("reads a site that blocks our browser", out.text.length > 1_000 && out.statusCode === 200,
      `status ${out.statusCode}, ${out.text.length} chars, $${(out.costMicros / 1_000_000).toFixed(4)}`);
    // Evidence capture renders this HTML; without it a blocked finding has no
    // route to a screenshot at all.
    report("returns HTML for evidence rendering", Boolean(out.html && out.html.length > 1_000),
      `${out.html?.length ?? 0} bytes`);
  } catch (err) {
    report("spider.cloud reachable", false, err instanceof Error ? err.message : String(err));
  }
}

/**
 * The acceptance contract every SERP vendor has to satisfy, run against each
 * one that is configured rather than only the primary.
 *
 * The `site:` assertion is the load-bearing one. Most of what `buildQueries`
 * generates is `site:`-scoped, so a vendor that does not honour operators does
 * not merely return worse results — scans silently fill with the brand's own
 * pages. It is exactly the test that disqualified one candidate provider whose
 * search endpoint turned out to be scraping DuckDuckGo and returning its ads.
 */
async function checkSearch(): Promise<void> {
  const providers: Array<{ label: string; make: () => SearchProvider }> = [
    {
      label: "YepAPI SERP",
      make: () => new YepApiClient({ apiKey: process.env.YEPAPI_API_KEY ?? "" }),
    },
  ];

  if (process.env.SERPER_DEV_API_KEY) {
    providers.push({
      label: "Serper (failover)",
      make: () => new SerperClient({ apiKey: process.env.SERPER_DEV_API_KEY!, maxPages: 1 }),
    });
  }

  for (const { label, make } of providers) {
    console.log(`\n${C.bold}Search — ${label}${C.reset}`);
    try {
      const search = make();

      const out = await search.search("brand protection software", { depth: 10 });
      report("API reachable", out.results.length > 0,
        `${out.results.length} result(s), $${(out.costMicros / 1_000_000).toFixed(4)}`);

      // Every open-web query the engine generates relies on Google operators
      // passing through the vendor untouched.
      const site = await search.search('site:dhgate.com "yeti"', { depth: 10 });
      const offSite = site.results.filter((r) => !r.displayLink.includes("dhgate.com"));
      report("site: operator honoured", site.results.length > 0 && offSite.length === 0,
        `${site.results.length} result(s), ${offSite.length} off-site`);

      const geo = await search.search('"replica watch"', { depth: 10, gl: "de" });
      report("location targeting accepted", geo.results.length > 0,
        `gl=de returned ${geo.results.length} result(s)`);
    } catch (err) {
      const msg = err instanceof SearchConfigError ? err.message : String(err);
      // A dead failover is a warning, not a failure: the tier still works.
      report("API reachable", label.startsWith("YepAPI") ? false : "warn", msg);
    }
  }

  if (!process.env.SERPER_DEV_API_KEY) {
    console.log(`\n${C.bold}Search — Serper (failover)${C.reset}`);
    report("SERPER_DEV_API_KEY", "warn", "not set — the search tier is single-vendor");
  }
}

async function checkGemini(): Promise<void> {
  console.log(`\n${C.bold}Gemini${C.reset}`);
  const apiKey = process.env.GEMINI_API_KEY ?? "";
  if (!apiKey) return report("classifier", false, "GEMINI_API_KEY not set");

  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: "Reply with the single word: ok",
    });
    report("model reachable", Boolean(res.text), `model responded: ${res.text?.trim().slice(0, 20)}`);
  } catch (err) {
    return report("model reachable", false, String(err).slice(0, 300));
  }

  // Behavioural check: the classifier must catch obvious infringement and,
  // just as importantly, leave legitimate coverage alone.
  const input: ScanInput = {
    brand: "Acme Tools", domain: "acmetools.com", industry: "electronics",
    aliases: [], allowlistDomains: [],
  };
  const page = (url: string, title: string, text: string): EnrichedResult => ({
    url, title: "", snippet: "", displayLink: "", sourceQuery: "q",
    finalUrl: url, httpStatus: 200, pageTitle: title, pageText: text,
    screenshot: null, fetchError: null, evidenceSource: "browser",
  });

  const cases = [
    { expect: "COUNTERFEIT", item: page("https://dhgate.test/a", "AAA Replica Acme Tools Drill",
        "Best price AAA quality replica Acme Tools cordless drill. Wholesale orders welcome. Same appearance as the original.") },
    { expect: "LEGITIMATE", item: page("https://toolreview.test/a", "Acme Tools Drill Review 2026",
        "We tested the Acme Tools cordless drill for six weeks. Build quality is excellent and battery life exceeded the rated figure. Available from authorized dealers.") },
    { expect: "PHISHING", item: page("https://acme-verify.test/login", "Acme Tools Account Verification",
        "Your Acme Tools account has been suspended. Verify your login credentials and payment card details immediately to restore access.") },
    { expect: "LEGITIMATE", item: page("https://news.test/a", "Acme Tools opens new factory",
        "Acme Tools announced it will open a manufacturing facility employing 400 people. The company reported record revenue this quarter.") },
  ];

  const classifier = new GeminiClassifier({ apiKey });
  const { byIndex, outcomes, rejectedForBadEvidence } = await classifier.classify(
    cases.map((c) => c.item),
    input,
  );

  /**
   * A dropped batch is not four legitimate pages. Scored the old way it came
   * out 2/4 — the two LEGITIMATE cases passing by accident — which sends
   * someone hunting a prompt regression while the actual fault is that the API
   * never answered.
   */
  const dropped = [...outcomes.values()].find((o) => o.status === "batch_failed");
  if (dropped?.status === "batch_failed") {
    report("classification sanity", false, `the model call failed: ${dropped.error}`);
    return;
  }

  let correct = 0;
  cases.forEach((c, i) => {
    // Omission is how the model says "nothing here", so it reads as LEGITIMATE;
    // a rejected quote is a different thing and says so.
    const missed = outcomes.get(i);
    const got =
      byIndex.get(i)?.category ??
      (missed?.status === "evidence_rejected"
        ? `${missed.category} with an unusable quote (${missed.reason})`
        : "LEGITIMATE");
    if (got === c.expect) correct++;
    else console.log(`        ${C.dim}${c.item.url}: expected ${c.expect}, got ${got}${C.reset}`);
  });
  report(`classification sanity (${correct}/${cases.length})`, correct === cases.length,
    `${rejectedForBadEvidence} finding(s) rejected for unverifiable evidence`);
}

async function checkBrowser(): Promise<void> {
  console.log(`\n${C.bold}Browser${C.reset}`);
  // Overridable so the check still works behind an egress allowlist, where a
  // failure here means "network blocked", not "browser broken".
  const target = process.env.PREFLIGHT_FETCH_URL ?? "https://example.com/";
  const fetcher = new PageFetcher({ screenshot: true });
  try {
    const got = await fetcher.fetchOne({
      url: target, title: "", snippet: "", displayLink: "", sourceQuery: "q",
    });
    const ok = got.httpStatus === 200 && Boolean(got.screenshot);
    report("fetch + screenshot", ok,
      ok
        ? `${target}: status ${got.httpStatus}, ${got.pageText?.length ?? 0} chars, ${got.screenshot?.length ?? 0} byte image`
        : `${target} unreachable (${got.fetchError ?? "no response"}). If this network restricts egress, set PREFLIGHT_FETCH_URL to a permitted host.`);

    const blocked = await fetcher.fetchOne({
      url: "http://169.254.169.254/latest/meta-data/", title: "", snippet: "", displayLink: "", sourceQuery: "q",
    });
    report("SSRF guard blocks metadata endpoint", Boolean(blocked.fetchError), blocked.fetchError ?? "NOT BLOCKED");
  } finally {
    await fetcher.close();
  }
}

async function main(): Promise<void> {
  console.log(`${C.bold}Defenex doctor${C.reset}`);
  await checkEnv();
  await checkSearch();
  await checkScraper();
  await checkGemini();
  await checkBrowser();

  console.log(
    failures === 0
      ? `\n${C.green}All checks passed.${C.reset}\n`
      : `\n${C.red}${failures} check(s) failed.${C.reset}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
