import { GoogleGenAI } from "@google/genai";
import type { FindingCategory } from "@defenex/shared";
import { silentLogger, type Logger } from "../ports.js";
import type { NoticeKind } from "./channels.js";

/**
 * The one part of a notice a model is allowed to write: a short factual
 * paragraph saying what the page shows and why it infringes.
 *
 * Everything the model produces here ends up inside a document someone signs.
 * So the output is not trusted on the way out — it is checked for the failure
 * modes that actually matter in a legal filing: inventing a URL, inventing a
 * registration number, or drifting into the sworn language that belongs to the
 * fixed frame. Anything that fails is discarded in favour of a deterministic
 * description built from the finding itself. A worse paragraph is a far better
 * outcome than a fluent false one.
 */

export const DEFAULT_DESCRIBER_MODEL = "gemini-3.6-flash";

export interface DescribeInput {
  brandName: string;
  category: FindingCategory;
  noticeKind: NoticeKind;
  url: string;
  pageTitle?: string | null;
  /** Verified to appear verbatim on the page. */
  evidenceQuote: string;
  /** The classifier's reasoning, as background. */
  reasoning?: string | null;
  markText?: string | null;
}

export interface NoticeDescriber {
  describe(input: DescribeInput): Promise<string>;
}

const MAX_DESCRIPTION_CHARS = 1_200;

/**
 * Phrases that carry legal weight and belong to the fixed frame. A model that
 * emits its own version of a sworn statement has produced a second, unreviewed
 * one — and the two need not agree.
 */
const RESERVED_LEGAL_PHRASES = [
  /penalty of perjury/i,
  /under oath/i,
  /\bi swear\b/i,
  /good faith belief/i,
  /authorized to act on behalf/i,
  /17 U\.?S\.?C/i,
  /§\s*512/,
  /\/s\//,
];

export interface SanitizeResult {
  ok: boolean;
  text: string;
  reasons: string[];
}

/**
 * Pure, so the guardrails can be tested without a model. Rejects rather than
 * repairs: a description that had to be edited to be safe is one we should not
 * be putting our name to.
 */
export function sanitizeDescription(raw: string, allowedUrl: string): SanitizeResult {
  const reasons: string[] = [];
  const text = raw.replace(/\s+/g, " ").trim();

  if (text.length < 40) reasons.push("too short to describe anything");
  if (text.length > MAX_DESCRIPTION_CHARS) reasons.push(`over ${MAX_DESCRIPTION_CHARS} characters`);

  // A paragraph that stops mid-sentence is what a token limit looks like from
  // the outside, and it reads in the finished notice as though the author lost
  // their train of thought. Cheap to detect, and the cause does not matter.
  if (text.length >= 40 && !/[.!?]["')\]]?$/.test(text)) {
    reasons.push("ends mid-sentence; the response was cut off");
  }

  for (const phrase of RESERVED_LEGAL_PHRASES) {
    if (phrase.test(text)) {
      reasons.push(`uses reserved legal wording (${phrase.source}) that belongs to the fixed frame`);
    }
  }

  // A hallucinated URL in a takedown notice points a provider at a page that
  // may belong to someone uninvolved.
  const allowedHost = hostOf(allowedUrl);
  for (const found of text.match(/https?:\/\/[^\s"'<>)]+/gi) ?? []) {
    if (hostOf(found) !== allowedHost) reasons.push(`cites an unrelated URL (${found})`);
  }

  // Registration numbers come from the verified rights record, never from a model.
  if (/registration\s+(no\.?|number)/i.test(text)) {
    reasons.push("states a registration number, which must come from the verified rights record");
  }

  return { ok: reasons.length === 0, text, reasons };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

const CATEGORY_PHRASING: Record<FindingCategory, string> = {
  COUNTERFEIT: "offers goods bearing the mark that did not originate with the rights holder and are not authorised",
  PHISHING: "imitates the brand's own site in order to collect credentials from its customers",
  DOMAIN_SQUAT: "uses a domain name confusingly similar to the mark",
  IMPERSONATION: "presents itself as the brand or as an official channel of the brand",
  UNAUTHORIZED_RESALE: "offers goods under the mark without authorisation from the rights holder",
  TRADEMARK_MISUSE: "uses the mark in a way that is likely to cause confusion as to source or affiliation",
  PIRACY: "distributes the work without licence from the rights holder",
  LEGITIMATE: "was classified as legitimate and should not be the subject of a notice",
};

/**
 * Deterministic description from the finding alone. Used when the model is
 * unavailable or its output is rejected — plainer, and never wrong about
 * anything we did not already verify.
 */
export function fallbackDescription(input: DescribeInput): string {
  const host = hostOf(input.url) ?? input.url;
  const title = input.pageTitle ? ` The page is titled "${input.pageTitle.trim()}".` : "";
  return (
    `The page at ${host} ${CATEGORY_PHRASING[input.category]}.` +
    title +
    ` It refers to ${input.markText ?? input.brandName} in the text quoted below, which was present on the page when it was captured.`
  );
}

const SYSTEM_PROMPT = [
  "You draft one factual paragraph for the description section of an intellectual property notice.",
  "",
  "Write only what the supplied evidence supports. State what the page shows and how it relates to the brand.",
  "",
  "Hard rules:",
  "- 2 to 5 sentences, plain declarative prose, no headings, no lists, no salutation.",
  "- Never invent a URL, a registration number, a price, a seller name, or a date.",
  "- Never write a legal conclusion, a sworn statement, or any variation of a good-faith or",
  "  penalty-of-perjury clause. Those are fixed text elsewhere in the document and are not yours to write.",
  "- Never cite a statute.",
  "- Do not quote the evidence text; it is reproduced separately.",
  "- If the evidence is thin, say less. An unsupported sentence is worse than a short paragraph.",
].join("\n");

export interface GeminiDescriberOptions {
  apiKey: string;
  model?: string;
  logger?: Logger;
}

export class GeminiDescriber implements NoticeDescriber {
  private readonly ai: GoogleGenAI;
  private readonly model: string;
  private readonly log: Logger;

  constructor(opts: GeminiDescriberOptions) {
    if (!opts.apiKey) throw new Error("GEMINI_API_KEY is not set");
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey });
    this.model = opts.model ?? DEFAULT_DESCRIBER_MODEL;
    this.log = opts.logger ?? silentLogger;
  }

  async describe(input: DescribeInput): Promise<string> {
    const prompt = [
      `Brand: ${input.brandName}`,
      input.markText ? `Registered mark: ${input.markText}` : null,
      `Notice type: ${input.noticeKind}`,
      `Classification: ${input.category}`,
      `URL: ${input.url}`,
      input.pageTitle ? `Page title: ${input.pageTitle}` : null,
      `Text found on the page: "${input.evidenceQuote}"`,
      input.reasoning ? `Analyst note: ${input.reasoning}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0,
          // Generous, because thinking tokens come out of the same budget: a
          // 400-token cap left the model enough to reason and not enough to
          // finish its last sentence, and the truncated paragraph was otherwise
          // well-formed enough to look deliberate. The length of the paragraph
          // is bounded by the sanitiser, not by starving the model.
          maxOutputTokens: 2_000,
        },
      });

      const checked = sanitizeDescription(response.text ?? "", input.url);
      if (!checked.ok) {
        this.log.warn("drafted description rejected; using deterministic fallback", {
          url: input.url,
          reasons: checked.reasons,
        });
        return fallbackDescription(input);
      }
      return checked.text;
    } catch (err) {
      this.log.warn("describer failed; using deterministic fallback", {
        url: input.url,
        error: err instanceof Error ? err.message : String(err),
      });
      return fallbackDescription(input);
    }
  }
}
