import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";
import { ScanInput, type Industry } from "@defenex/shared";
import { YepApiClient } from "./search/yepapi.js";
import { GeminiClassifier } from "./classify/gemini.js";
import { PageFetcher } from "./enrich/fetch.js";
import { StealthScraper } from "./enrich/stealth.js";
import { runScan } from "./scan.js";
import { severityLabel } from "./score/index.js";
import { QuotaExceededError, SearchConfigError } from "./errors.js";
import { consoleLogger, silentLogger } from "./ports.js";

// Node >= 20.6 can read .env itself; no dotenv dependency needed.
try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url).pathname);
} catch {
  // Fine — the environment may already carry the variables.
}

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  red: "\x1b[31m", yellow: "\x1b[33m", blue: "\x1b[34m", grey: "\x1b[90m",
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: C.red, high: C.yellow, medium: C.blue, low: C.grey,
};

function usage(): never {
  console.log(`
${C.bold}defenex scan${C.reset} — run the detection engine against a brand

  --brand      <name>     required
  --domain     <domain>   required, bare domain e.g. acme.com
  --industry   <pack>     fashion|electronics|software|cosmetics|supplements|generic
  --alias      <name>     repeatable
  --allow      <domain>   authorized domain to ignore, repeatable
  --budget     <n>        max search calls (default 15, $0.01 each)
  --depth      <n>        results per call (default 50, max 100 — same price)
  --max-enrich <n>        max pages to fetch (default 40)
  --stealth-budget <n>    max paid stealth scrapes for blocked sites (default 8, $0.03 each)
  --no-stealth            never fall back to the paid scraper
  --out        <file>     write full JSON results
  --quiet                 suppress progress logging

Example:
  pnpm scan --brand "Acme Tools" --domain acmetools.com --industry electronics
`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      brand: { type: "string" },
      domain: { type: "string" },
      industry: { type: "string", default: "generic" },
      alias: { type: "string", multiple: true, default: [] },
      allow: { type: "string", multiple: true, default: [] },
      budget: { type: "string" },
      depth: { type: "string" },
      "max-enrich": { type: "string" },
      out: { type: "string" },
      quiet: { type: "boolean", default: false },
      "no-stealth": { type: "boolean", default: false },
      "stealth-budget": { type: "string" },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.help || !values.brand || !values.domain) usage();

  const parsed = ScanInput.safeParse({
    brand: values.brand,
    domain: values.domain,
    industry: values.industry as Industry,
    aliases: values.alias,
    allowlistDomains: values.allow,
    queryBudget: values.budget ? Number(values.budget) : undefined,
  });

  if (!parsed.success) {
    console.error(`${C.red}Invalid input:${C.reset}`);
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  const input = parsed.data;
  const logger = values.quiet ? silentLogger : consoleLogger;

  const search = new YepApiClient({
    apiKey: process.env.YEPAPI_API_KEY ?? "",
    dailyCap: process.env.SEARCH_DAILY_CAP ? Number(process.env.SEARCH_DAILY_CAP) : undefined,
    defaultDepth: values.depth ? Number(values.depth) : undefined,
    logger,
  });
  const classifier = new GeminiClassifier({
    apiKey: process.env.GEMINI_API_KEY ?? "",
    logger,
  });
  const stealth = values["no-stealth"]
    ? undefined
    : new StealthScraper({ apiKey: process.env.YEPAPI_API_KEY ?? "", logger });
  const fetcher = new PageFetcher({
    logger,
    screenshot: true,
    ...(stealth ? { stealth } : {}),
    ...(values["stealth-budget"] ? { stealthBudget: Number(values["stealth-budget"]) } : {}),
  });

  // A `finally` does not run when the process is signalled, so Ctrl-C or a
  // `timeout` wrapper would leave the browser and its ~10 child processes
  // orphaned, each holding ~100MB. Observed in testing: three abandoned scans
  // left eleven headless-shell processes alive.
  let shuttingDown = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`\n${C.dim}${signal} received — closing browser…${C.reset}\n`);
    void fetcher.close().finally(() => process.exit(130));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  process.once("SIGHUP", onSignal);

  console.log(
    `\n${C.bold}Scanning ${input.brand}${C.reset} ${C.dim}(${input.domain}, ${input.industry})${C.reset}\n`,
  );

  try {
    const result = await runScan(input, {
      search,
      classifier,
      fetcher,
      logger,
      maxEnrich: values["max-enrich"] ? Number(values["max-enrich"]) : undefined,
      onProgress: (stage, pct) => {
        if (!values.quiet) process.stderr.write(`${C.dim}  [${String(pct).padStart(3)}%] ${stage}${C.reset}\n`);
      },
    });

    printReport(result);

    if (values.out) {
      // Screenshots are large binaries; keep the JSON readable.
      const serializable = {
        ...result,
        findings: result.findings.map(({ screenshot, ...f }) => ({
          ...f,
          hasScreenshot: screenshot !== null,
        })),
      };
      await writeFile(values.out, JSON.stringify(serializable, null, 2));
      console.log(`${C.dim}Full results written to ${values.out}${C.reset}`);
    }
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      console.error(`\n${C.yellow}${err.message}${C.reset}`);
      console.error(`${C.dim}Raise CSE_DAILY_CAP or wait for the daily reset.${C.reset}`);
      process.exit(2);
    }
    if (err instanceof SearchConfigError) {
      console.error(`\n${C.red}Search configuration problem${C.reset}\n${err.message}`);
      process.exit(3);
    }
    throw err;
  } finally {
    await fetcher.close();
  }
}

function printReport(result: Awaited<ReturnType<typeof runScan>>): void {
  const { findings, stats } = result;

  console.log(`\n${C.bold}Findings (${findings.length})${C.reset}\n`);

  if (findings.length === 0) {
    console.log(`  ${C.dim}Nothing met the evidence bar. That is a valid result.${C.reset}\n`);
  }

  for (const f of findings) {
    const label = severityLabel(f.severity);
    const color = SEVERITY_COLOR[label] ?? C.grey;
    console.log(
      `  ${color}${label.toUpperCase().padEnd(8)}${C.reset} ${String(f.severity).padStart(3)}  ` +
        `${C.bold}${f.category}${C.reset} ${C.dim}(${f.confidence})${C.reset}`,
    );
    console.log(`           ${f.url}`);
    console.log(`           ${C.dim}"${f.evidenceQuote.slice(0, 140)}"${C.reset}`);
    console.log("");
  }

  const dollars = (stats.costMicros / 1_000_000).toFixed(4);
  console.log(`${C.bold}Stats${C.reset}`);
  console.log(`  ${C.dim}Search API calls   ${C.reset}${stats.queriesRun}`);
  console.log(`  ${C.dim}Results seen       ${C.reset}${stats.resultsSeen}`);
  console.log(`  ${C.dim}After allowlist    ${C.reset}${stats.resultsAfterAllowlist}`);
  console.log(`  ${C.dim}Pages fetched      ${C.reset}${stats.resultsEnriched} (${stats.fetchFailures} failed)`);
  console.log(`  ${C.dim}Stealth scrapes    ${C.reset}${stats.stealthCallsUsed}`);
  console.log(`  ${C.dim}Findings published ${C.reset}${stats.findingsPublished}`);
  console.log(`  ${C.dim}Rejected (evidence)${C.reset}${stats.rejectedForBadEvidence}`);
  console.log(`  ${C.dim}Cost               ${C.reset}$${dollars} ` +
    `${C.dim}(search $${(stats.searchCostMicros / 1e6).toFixed(3)}, ` +
    `stealth $${(stats.stealthCostMicros / 1e6).toFixed(3)})${C.reset}`);
  console.log(`  ${C.dim}Duration           ${C.reset}${(stats.durationMs / 1000).toFixed(1)}s`);
  const counts = Object.entries(stats.categoryCounts).sort((a, b) => b[1] - a[1]);
  if (counts.length) {
    console.log(`\n${C.bold}What the ${stats.resultsEnriched} fetched pages were${C.reset}`);
    for (const [cat, n] of counts) console.log(`  ${C.dim}${cat.padEnd(20)}${C.reset}${n}`);
  }
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
