import type { FindingCategory } from "@defenex/shared";
import type { NoticeKind, TakedownChannel } from "./channels.js";

/**
 * Notice bodies.
 *
 * The legal frame is fixed text. The model writes one paragraph — a factual
 * description of what the page shows — and nothing else. A sworn statement is
 * not a thing a language model may paraphrase: "under penalty of perjury" has a
 * defined meaning, the wording is quoted from 17 U.S.C. §512(c)(3) or from what
 * the platforms require, and a rewording that softens or overstates it is a
 * defect in a legal document rather than a stylistic variation.
 *
 * `missingRequiredStatements` re-checks the rendered output for every element
 * the notice type requires. It runs before a draft may enter the approval
 * queue, so editing a template cannot silently drop a sworn element.
 */

export interface RightsCitation {
  markText: string;
  regNumber: string;
  jurisdiction: string;
  registeredAt?: string | null;
  ownerName?: string | null;
}

export interface EvidenceCitation {
  capturedAt: string;
  bundleSha256?: string | null;
  screenshotSha256?: string | null;
  httpStatus?: number | null;
}

export interface Signatory {
  name: string;
  title: string;
  organisation: string;
  email: string;
  phone?: string | null;
  address?: string | null;
}

export interface NoticeContext {
  noticeKind: NoticeKind;
  channel: TakedownChannel;
  /** Platform or company the notice is addressed to. */
  recipient: string;
  category: FindingCategory;
  brandName: string;
  /** The rights holder the notice is filed for. */
  onBehalfOf: string;
  rights: RightsCitation | null;
  infringingUrl: string;
  finalUrl?: string | null;
  /** Verbatim quote from the page, already verified to appear in it. */
  evidenceQuote: string;
  evidence: EvidenceCitation;
  /** The model's factual paragraph. */
  description: string;
  signatory: Signatory;
}

export interface RenderedNotice {
  subject: string;
  body: string;
  /** Ids of the statements this notice type requires, for the audit record. */
  requiredStatements: string[];
}

interface RequiredStatement {
  id: string;
  /** Why the law or the platform demands it — surfaced when one goes missing. */
  because: string;
  /** Matched against the rendered body. */
  pattern: RegExp;
}

/**
 * 17 U.S.C. §512(c)(3)(A)(i)-(vi). Quoted, not paraphrased: (v) and (vi) are
 * the two the statute prescribes almost word for word.
 */
const COPYRIGHT_STATEMENTS: RequiredStatement[] = [
  { id: "identify_work", because: "§512(c)(3)(A)(ii) — identification of the copyrighted work", pattern: /copyrighted work/i },
  { id: "identify_material", because: "§512(c)(3)(A)(iii) — location of the infringing material", pattern: /https?:\/\//i },
  { id: "contact_info", because: "§512(c)(3)(A)(iv) — contact information for the complaining party", pattern: /@/ },
  {
    id: "good_faith",
    because: "§512(c)(3)(A)(v) — good-faith belief statement",
    pattern: /good faith belief that use of the material in the manner complained of is not authorized by the copyright owner, its agent, or the law/i,
  },
  {
    id: "accuracy_and_authority",
    because: "§512(c)(3)(A)(vi) — accuracy and authority, under penalty of perjury",
    pattern: /under penalty of perjury, that I am authorized to act on behalf of the owner of an exclusive right that is allegedly infringed/i,
  },
  { id: "signature", because: "§512(c)(3)(A)(i) — physical or electronic signature", pattern: /\/s\/\s*\S/ },
];

/**
 * Trademark notices have no statutory form. These are the elements the major
 * platforms require, and the §512 perjury clause is deliberately absent: it
 * attaches to copyright ownership and swearing it over a mark would be false.
 */
const TRADEMARK_STATEMENTS: RequiredStatement[] = [
  { id: "identify_mark", because: "the mark relied on, with its registration number", pattern: /registration no\.?\s*\S+/i },
  { id: "identify_material", because: "the location of the infringing material", pattern: /https?:\/\//i },
  { id: "contact_info", because: "contact information for the complaining party", pattern: /@/ },
  {
    id: "good_faith",
    because: "good-faith belief that the use is unauthorised",
    pattern: /good faith belief that the use described above is not authorized by the trademark owner, its agent, or the law/i,
  },
  {
    id: "accuracy_and_authority",
    because: "accuracy of the notice and authority to act for the owner",
    pattern: /information in this notice is accurate and that I am authorized to act on behalf of the owner of the trademark/i,
  },
  { id: "signature", because: "signature of the person giving notice", pattern: /\/s\/\s*\S/ },
];

/**
 * A phishing report is not an intellectual-property notice and must not
 * pretend to be one. It asks a provider to act on fraud, so it carries no
 * perjury clause and makes no claim to an exclusive right.
 */
const PHISHING_STATEMENTS: RequiredStatement[] = [
  { id: "identify_material", because: "the location of the fraudulent page", pattern: /https?:\/\//i },
  { id: "contact_info", because: "contact information for the reporting party", pattern: /@/ },
  { id: "impersonation", because: "what the page impersonates", pattern: /impersonat/i },
  {
    id: "good_faith",
    because: "good-faith belief that the page is fraudulent",
    pattern: /good faith belief that the page described above is fraudulent and is operated without authorisation/i,
  },
  { id: "signature", because: "signature of the person reporting", pattern: /\/s\/\s*\S/ },
];

const STATEMENTS: Record<NoticeKind, RequiredStatement[]> = {
  copyright: COPYRIGHT_STATEMENTS,
  trademark: TRADEMARK_STATEMENTS,
  phishing_abuse: PHISHING_STATEMENTS,
};

export function requiredStatementsFor(kind: NoticeKind): ReadonlyArray<{ id: string; because: string }> {
  return STATEMENTS[kind].map(({ id, because }) => ({ id, because }));
}

/** Empty means the notice carries every element its type requires. */
export function missingRequiredStatements(body: string, kind: NoticeKind): Array<{ id: string; because: string }> {
  return STATEMENTS[kind]
    .filter((s) => !s.pattern.test(body))
    .map(({ id, because }) => ({ id, because }));
}

/**
 * Unresolved template slots. A notice still carrying one is a draft, and the
 * check exists so it cannot be mistaken for a finished document at approval.
 *
 * Matched case-sensitively against the lowercase form the templates use, so
 * bracketed text quoted from a page — "[Genuine] YETI" — is not reported as an
 * unfilled field. A lowercase bracketed phrase inside a quote would still trip
 * it, which errs toward showing the reviewer something they can dismiss.
 */
export function unresolvedPlaceholders(body: string): string[] {
  return [...new Set(body.match(/\[[a-z][a-z0-9 _-]*\]/g) ?? [])];
}

// ------------------------------------------------------------ rendering

function evidenceBlock(e: EvidenceCitation, url: string, finalUrl?: string | null): string {
  const lines = [
    `The page at ${url} was retrieved and preserved on ${e.capturedAt}.`,
  ];
  if (finalUrl && finalUrl !== url) lines.push(`It resolved to ${finalUrl}.`);
  if (e.httpStatus != null) lines.push(`The server returned HTTP ${e.httpStatus}.`);
  lines.push(
    "A full-page screenshot, the page source and the response headers were captured at that time and are available on request.",
  );
  if (e.screenshotSha256) lines.push(`Screenshot SHA-256: ${e.screenshotSha256}.`);
  if (e.bundleSha256) lines.push(`Evidence bundle SHA-256: ${e.bundleSha256}.`);
  return lines.join(" ");
}

function signatureBlock(s: Signatory, onBehalfOf: string): string {
  return [
    `/s/ ${s.name}`,
    `${s.name}, ${s.title}`,
    s.organisation,
    `Authorised agent for ${onBehalfOf}`,
    s.email,
    s.phone ?? null,
    s.address ?? null,
  ]
    .filter(Boolean)
    .join("\n");
}

function rightsBlock(r: RightsCitation | null): string {
  if (!r) return "";
  const parts = [
    `The mark relied on is ${r.markText}, ${r.jurisdiction} Registration No. ${r.regNumber}`,
  ];
  if (r.registeredAt) parts.push(`registered ${r.registeredAt}`);
  if (r.ownerName) parts.push(`recorded owner ${r.ownerName}`);
  return `${parts.join(", ")}.`;
}

export function renderNotice(ctx: NoticeContext): RenderedNotice {
  const body =
    ctx.noticeKind === "copyright"
      ? renderCopyright(ctx)
      : ctx.noticeKind === "phishing_abuse"
        ? renderPhishing(ctx)
        : renderTrademark(ctx);

  const subject =
    ctx.noticeKind === "copyright"
      ? `DMCA Notice of Claimed Infringement — ${ctx.brandName} — ${hostOf(ctx.infringingUrl)}`
      : ctx.noticeKind === "phishing_abuse"
        ? `Phishing report — page impersonating ${ctx.brandName} — ${hostOf(ctx.infringingUrl)}`
        : `Trademark Infringement Notice — ${ctx.brandName} — ${hostOf(ctx.infringingUrl)}`;

  return { subject, body, requiredStatements: STATEMENTS[ctx.noticeKind].map((s) => s.id) };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function renderTrademark(ctx: NoticeContext): string {
  return `To: ${ctx.recipient}

I am writing on behalf of ${ctx.onBehalfOf} concerning material that infringes its trademark rights.

1. RIGHTS RELIED ON
${rightsBlock(ctx.rights) || `The mark relied on is ${ctx.brandName}. Registration No. [registration number] ([jurisdiction]).`}

2. MATERIAL COMPLAINED OF
${ctx.infringingUrl}

3. DESCRIPTION
${ctx.description.trim()}

The following text appears on the page as captured:
"${ctx.evidenceQuote.trim()}"

4. EVIDENCE
${evidenceBlock(ctx.evidence, ctx.infringingUrl, ctx.finalUrl)}

5. REQUESTED ACTION
Please remove or disable access to the material identified above.

6. STATEMENTS
I have a good faith belief that the use described above is not authorized by the trademark owner, its agent, or the law.

I declare that the information in this notice is accurate and that I am authorized to act on behalf of the owner of the trademark said to be infringed.

${signatureBlock(ctx.signatory, ctx.onBehalfOf)}`;
}

function renderCopyright(ctx: NoticeContext): string {
  return `To: ${ctx.recipient}

This is a notification under 17 U.S.C. §512(c)(3) submitted on behalf of ${ctx.onBehalfOf}.

1. COPYRIGHTED WORK
${ctx.description.trim()}

2. MATERIAL CLAIMED TO BE INFRINGING
${ctx.infringingUrl}

The following text appears on the page as captured:
"${ctx.evidenceQuote.trim()}"

3. EVIDENCE
${evidenceBlock(ctx.evidence, ctx.infringingUrl, ctx.finalUrl)}

4. REQUESTED ACTION
Please expeditiously remove or disable access to the material identified above.

5. STATEMENTS
I have a good faith belief that use of the material in the manner complained of is not authorized by the copyright owner, its agent, or the law.

I declare that the information in this notification is accurate, and under penalty of perjury, that I am authorized to act on behalf of the owner of an exclusive right that is allegedly infringed.

${signatureBlock(ctx.signatory, ctx.onBehalfOf)}`;
}

function renderPhishing(ctx: NoticeContext): string {
  return `To: ${ctx.recipient}

This is a report of a fraudulent page impersonating ${ctx.onBehalfOf}. It is not an intellectual property notice and no claim under 17 U.S.C. §512 is made.

1. FRAUDULENT PAGE
${ctx.infringingUrl}

2. WHAT IT IMPERSONATES
The page impersonates ${ctx.brandName}${ctx.rights ? ` (${ctx.rights.jurisdiction} Registration No. ${ctx.rights.regNumber})` : ""}.

${ctx.description.trim()}

The following text appears on the page as captured:
"${ctx.evidenceQuote.trim()}"

3. EVIDENCE
${evidenceBlock(ctx.evidence, ctx.infringingUrl, ctx.finalUrl)}

4. REQUESTED ACTION
Please suspend the page pending investigation. If credentials have been collected through it, the affected accounts are at immediate risk.

5. STATEMENT
I have a good faith belief that the page described above is fraudulent and is operated without authorisation from ${ctx.onBehalfOf}.

${signatureBlock(ctx.signatory, ctx.onBehalfOf)}`;
}
