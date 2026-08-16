import { describe, it, expect } from "vitest";
import {
  renderNotice,
  missingRequiredStatements,
  requiredStatementsFor,
  unresolvedPlaceholders,
  type NoticeContext,
} from "../src/takedown/templates.js";
import { noticeKindFor } from "../src/takedown/channels.js";

function ctx(overrides: Partial<NoticeContext> = {}): NoticeContext {
  return {
    noticeKind: "trademark",
    channel: "dhgate",
    recipient: "DHgate IPR Complaint",
    category: "COUNTERFEIT",
    brandName: "YETI",
    onBehalfOf: "YETI Coolers, LLC",
    rights: {
      markText: "YETI",
      regNumber: "4213456",
      jurisdiction: "US",
      registeredAt: "2012-09-25",
      ownerName: "YETI Coolers, LLC",
    },
    infringingUrl: "https://www.dhgate.com/wholesale/replica+yeti+cooler.html",
    finalUrl: null,
    evidenceQuote: "Replica YETI Tundra 45 cooler, factory direct",
    evidence: { capturedAt: "2026-08-15T12:00:00.000Z", httpStatus: 200, screenshotSha256: "abc123" },
    description: "The page offers a cooler described as a replica of the brand's product.",
    signatory: {
      name: "Dana Reeve",
      title: "Brand Protection Agent",
      organisation: "Defenex",
      email: "notices@defenex.com",
    },
    ...overrides,
  };
}

describe("every notice type carries the statements it requires", () => {
  it.each([["trademark"], ["copyright"], ["phishing_abuse"]] as const)("%s", (kind) => {
    const notice = renderNotice(ctx({ noticeKind: kind }));
    expect(missingRequiredStatements(notice.body, kind)).toEqual([]);
    expect(notice.requiredStatements).toEqual(requiredStatementsFor(kind).map((s) => s.id));
  });
});

describe("the copyright and trademark frames stay apart", () => {
  // Swearing copyright ownership over a trademark claim is a false statement
  // made under oath, and §512(f) is written for exactly that.
  it("keeps the perjury clause out of a trademark notice", () => {
    const body = renderNotice(ctx({ noticeKind: "trademark" })).body;
    expect(body).not.toMatch(/penalty of perjury/i);
    expect(body).not.toMatch(/copyright/i);
    expect(body).not.toMatch(/512/);
  });

  it("uses the statutory wording verbatim in a copyright notice", () => {
    const body = renderNotice(ctx({ noticeKind: "copyright", category: "PIRACY" })).body;
    expect(body).toContain("17 U.S.C. §512(c)(3)");
    expect(body).toContain(
      "under penalty of perjury, that I am authorized to act on behalf of the owner of an exclusive right that is allegedly infringed",
    );
  });

  // A fraud report is not an IP notice and must not borrow its authority.
  it("makes no rights claim and swears nothing in a phishing report", () => {
    const body = renderNotice(ctx({ noticeKind: "phishing_abuse", category: "PHISHING" })).body;
    expect(body).not.toMatch(/penalty of perjury/i);
    expect(body).toContain("no claim under 17 U.S.C. §512 is made");
    expect(body).toMatch(/impersonat/i);
  });

  it("labels the subject line by frame", () => {
    expect(renderNotice(ctx({ noticeKind: "copyright" })).subject).toContain("DMCA");
    expect(renderNotice(ctx({ noticeKind: "trademark" })).subject).not.toContain("DMCA");
    expect(renderNotice(ctx({ noticeKind: "phishing_abuse" })).subject).toContain("Phishing");
  });
});

describe("the notice reports only what was verified", () => {
  it("cites the registration from the rights record", () => {
    const body = renderNotice(ctx()).body;
    expect(body).toContain("US Registration No. 4213456");
    expect(body).toContain("recorded owner YETI Coolers, LLC");
  });

  it("reproduces the evidence quote verbatim", () => {
    const body = renderNotice(ctx()).body;
    expect(body).toContain('"Replica YETI Tundra 45 cooler, factory direct"');
  });

  it("states the capture time and the artifact hash", () => {
    const body = renderNotice(ctx()).body;
    expect(body).toContain("2026-08-15T12:00:00.000Z");
    expect(body).toContain("Screenshot SHA-256: abc123");
  });

  it("records a redirect when the final URL differs", () => {
    const body = renderNotice(ctx({ finalUrl: "https://www.dhgate.com/product/999.html" })).body;
    expect(body).toContain("It resolved to https://www.dhgate.com/product/999.html");
  });

  // A notice with no registration on file is still rendered, but the gap is
  // visible as an unfilled field rather than quietly omitted.
  it("leaves a visible placeholder rather than dropping the rights section", () => {
    const notice = renderNotice(ctx({ rights: null }));
    expect(unresolvedPlaceholders(notice.body)).toContain("[registration number]");
  });
});

describe("missingRequiredStatements", () => {
  it("catches a frame that lost its good-faith clause", () => {
    const body = renderNotice(ctx()).body.replace(/I have a good faith belief[^\n]*/, "");
    const missing = missingRequiredStatements(body, "trademark");
    expect(missing.map((m) => m.id)).toContain("good_faith");
    expect(missing[0]?.because).toBeTruthy();
  });

  it("catches an unsigned notice", () => {
    const body = renderNotice(ctx()).body.replace(/\/s\/.*/, "");
    expect(missingRequiredStatements(body, "trademark").map((m) => m.id)).toContain("signature");
  });

  // A trademark body checked as copyright must fail: it has no §512 clause.
  it("does not accept a trademark body as a copyright notice", () => {
    const body = renderNotice(ctx({ noticeKind: "trademark" })).body;
    expect(missingRequiredStatements(body, "copyright").length).toBeGreaterThan(0);
  });

  it("passes a complete notice for the category it was rendered for", () => {
    for (const category of ["COUNTERFEIT", "PIRACY", "PHISHING", "DOMAIN_SQUAT"] as const) {
      const kind = noticeKindFor(category);
      const body = renderNotice(ctx({ noticeKind: kind, category })).body;
      expect(missingRequiredStatements(body, kind), category).toEqual([]);
    }
  });
});

describe("unresolvedPlaceholders", () => {
  it("finds the approver slot every draft carries", () => {
    const body = renderNotice(ctx({ signatory: { ...ctx().signatory, name: "[approver name]" } })).body;
    expect(unresolvedPlaceholders(body)).toContain("[approver name]");
  });

  it("does not mistake bracketed evidence text for a slot", () => {
    const body = renderNotice(ctx({ evidenceQuote: "Sold as [Genuine] YETI" })).body;
    // "[Genuine]" is capitalised content, not a lowercase template slot.
    expect(unresolvedPlaceholders(body)).not.toContain("[Genuine]");
  });

  it("reports nothing for a fully filled notice", () => {
    expect(unresolvedPlaceholders(renderNotice(ctx()).body)).toEqual([]);
  });
});
