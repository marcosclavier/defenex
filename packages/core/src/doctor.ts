/**
 * Preflight check for every external dependency the engine needs.
 * Run after changing credentials: `pnpm doctor`
 */
import { GoogleGenAI } from "@google/genai";
import { YepApiClient } from "./search/yepapi.js";
import { GeminiClassifier } from "./classify/gemini.js";
import { PageFetcher } from "./enrich/fetch.js";
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
    "DATABASE_URL", "REDIS_URL", "RESEND_API_KEY", "APIFY_API_KEY",
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

async function checkSearch(): Promise<void> {
  console.log(`\n${C.bold}Search (YepAPI SERP)${C.reset}`);
  try {
    const search = new YepApiClient({ apiKey: process.env.YEPAPI_API_KEY ?? "" });

    const out = await search.search("brand protection software", { depth: 10 });
    report("API reachable", out.results.length > 0,
      `${out.results.length} result(s), $${(out.costMicros / 1_000_000).toFixed(3)}`);

    // Every open-web query the engine generates relies on Google operators
    // passing through the vendor untouched. If they stop working, scans
    // silently fill with the brand's own pages.
    const site = await search.search('site:dhgate.com "yeti"', { depth: 10 });
    const offSite = site.results.filter((r) => !r.displayLink.includes("dhgate.com"));
    report("site: operator honoured", site.results.length > 0 && offSite.length === 0,
      `${site.results.length} result(s), ${offSite.length} off-site`);

    // Non-US location codes are inferred from the DataForSEO pattern
    // (2000 + ISO 3166-1 numeric); only 2840/US is vendor-documented.
    const geo = await search.search('"replica watch"', { depth: 10, gl: "de" });
    report("location targeting accepted", geo.results.length > 0,
      `gl=de returned ${geo.results.length} result(s)`);
  } catch (err) {
    const msg = err instanceof SearchConfigError ? err.message : String(err);
    report("API reachable", false, msg);
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
  const { byIndex, rejectedForBadEvidence } = await classifier.classify(cases.map((c) => c.item), input);

  let correct = 0;
  cases.forEach((c, i) => {
    const got = byIndex.get(i)?.category ?? "LEGITIMATE";
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
