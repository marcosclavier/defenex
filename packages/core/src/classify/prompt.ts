import type { EnrichedResult, ScanInput } from "@defenex/shared";

/** Text the classifier is allowed to quote from. Order matches what it sees. */
export function sourceTextFor(item: EnrichedResult): string {
  const parts = [item.pageTitle ?? item.title, item.pageText ?? item.snippet];
  return parts.filter(Boolean).join("\n").replace(/\s+/g, " ").trim();
}

export function buildSystemPrompt(): string {
  return [
    "You are a brand protection analyst. You review web pages and decide whether each",
    "one infringes a specific brand. Your output feeds a report sent to that brand's",
    "legal and marketing team, so a wrong accusation is far more damaging than a miss.",
    "",
    "CATEGORIES",
    "- COUNTERFEIT: offers goods bearing the brand's marks that are not authorized.",
    "- PHISHING: impersonates the brand to harvest credentials, payment, or personal data.",
    "- DOMAIN_SQUAT: a confusingly similar domain, parked, for sale, or imitating the brand.",
    "- IMPERSONATION: a social, messaging, or support account posing as the brand.",
    "- UNAUTHORIZED_RESALE: genuine goods sold through an apparently unapproved channel.",
    "- TRADEMARK_MISUSE: the marks used in ads or content without apparent license.",
    "- PIRACY: cracked software, leaked media, or license-key distribution.",
    "- LEGITIMATE: anything else. Use this freely.",
    "",
    "RULES",
    "1. evidenceQuote MUST be copied verbatim, character for character, from the SOURCE",
    "   TEXT of that page. Do not paraphrase, summarize, translate, or repair it. If no",
    "   sentence in the source supports your call, the answer is LEGITIMATE.",
    "2. Default to LEGITIMATE. Classify as infringement only when the source text itself",
    "   shows it. Suspicion about a domain name alone is not evidence.",
    "3. These are LEGITIMATE, not findings: the brand's own pages, news and press",
    "   coverage, reviews, forum discussion, retailers plainly selling genuine stock,",
    "   job listings, and directory or encyclopedia entries.",
    "4. A marketplace listing is only COUNTERFEIT when the text indicates replica, fake,",
    "   or unauthorized goods. A genuine item resold is UNAUTHORIZED_RESALE at most.",
    "5. confidence: 'high' only when the quote plainly establishes the category on its",
    "   own. 'medium' when it is suggestive. 'low' when you are guessing — and if you",
    "   are guessing, prefer LEGITIMATE.",
    "6. reasoning: one sentence, factual, no legal conclusions. Never write that",
    "   something is illegal or criminal; describe only what the page appears to do.",
  ].join("\n");
}

export function buildUserPrompt(items: EnrichedResult[], input: ScanInput): string {
  const header = [
    `BRAND: ${input.brand}`,
    `OFFICIAL DOMAIN: ${input.domain}`,
    `INDUSTRY: ${input.industry}`,
    input.aliases.length ? `ALSO KNOWN AS: ${input.aliases.join(", ")}` : null,
    "",
    `Classify each of the ${items.length} pages below. Return one object per page,`,
    "using the same index. Quote only from that page's SOURCE TEXT.",
    "",
  ]
    .filter((l) => l !== null)
    .join("\n");

  const blocks = items.map((item, i) => {
    const host = safeHost(item.finalUrl || item.url);
    return [
      `--- PAGE ${i} ---`,
      `URL: ${item.finalUrl || item.url}`,
      `DOMAIN: ${host}`,
      item.fetchError ? `NOTE: page could not be fetched (${item.fetchError}); only the search snippet is available.` : null,
      "SOURCE TEXT:",
      sourceTextFor(item) || "(empty)",
    ]
      .filter((l) => l !== null)
      .join("\n");
  });

  return `${header}${blocks.join("\n\n")}`;
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
