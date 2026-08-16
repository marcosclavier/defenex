import { describe, it, expect } from "vitest";
import { prepareForSubmission, renderNotice, APPROVER_PLACEHOLDER } from "../src/takedown/templates.js";
import type { NoticeContext } from "../src/takedown/templates.js";

function draft(overrides: Partial<NoticeContext> = {}) {
  return renderNotice({
    noticeKind: "trademark",
    channel: "dhgate",
    recipient: "DHgate IPR Complaint",
    category: "COUNTERFEIT",
    brandName: "YETI",
    onBehalfOf: "YETI Coolers, LLC",
    rights: { markText: "YETI", regNumber: "4213456", jurisdiction: "US" },
    infringingUrl: "https://www.dhgate.com/wholesale/replica+yeti+cooler.html",
    evidenceQuote: "Replica YETI Tundra 45 cooler",
    evidence: { capturedAt: "2026-08-15T12:00:00.000Z", httpStatus: 200 },
    description: "The page offers a cooler described as a replica of the brand's product.",
    signatory: {
      name: APPROVER_PLACEHOLDER,
      title: "Brand Protection Agent",
      organisation: "Defenex",
      email: "notices@defenex.com",
    },
    ...overrides,
  }).body;
}

describe("prepareForSubmission", () => {
  it("signs the notice with the approver's name", () => {
    const result = prepareForSubmission({ body: draft(), noticeKind: "trademark", approverName: "Dana Reeve" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notice.signedByName).toBe("Dana Reeve");
    expect(result.notice.body).toContain("/s/ Dana Reeve");
    expect(result.notice.body).not.toContain(APPROVER_PLACEHOLDER);
  });

  /**
   * The whole point of review is that the approver may edit. Nothing stops them
   * deleting a sworn clause along with a sentence they disliked, and the
   * draft-time check ran against different bytes.
   */
  it("refuses a notice whose good-faith statement was edited out", () => {
    const edited = draft().replace(/I have a good faith belief[^\n]*/, "This is clearly infringing.");
    const result = prepareForSubmission({ body: edited, noticeKind: "trademark", approverName: "Dana Reeve" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join(" ")).toContain("good_faith");
  });

  it("refuses a notice whose authority statement was edited out", () => {
    const edited = draft().replace(/I declare that the information[^\n]*/, "");
    const result = prepareForSubmission({ body: edited, noticeKind: "trademark", approverName: "Dana Reeve" });
    expect(result.ok).toBe(false);
  });

  it("reports every missing element, not merely the first", () => {
    const gutted = "To: Someone\n\nPlease remove https://example.com/x.\n";
    const result = prepareForSubmission({ body: gutted, noticeKind: "copyright", approverName: "Dana Reeve" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.length).toBeGreaterThan(2);
  });

  // An unnamed approver cannot sign, and an unsigned notice is not a notice.
  it.each([[""], ["  "], ["A"]])("refuses to sign for an approver named %o", (approverName) => {
    const result = prepareForSubmission({ body: draft(), noticeKind: "trademark", approverName });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join(" ")).toContain("no name recorded");
  });

  it("refuses a notice still carrying an unfilled field", () => {
    const result = prepareForSubmission({
      body: draft({ rights: null }),
      noticeKind: "trademark",
      approverName: "Dana Reeve",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join(" ")).toContain("[registration number]");
  });

  // A trademark body checked as copyright has no §512 clause and must fail,
  // even though it is a perfectly valid document under its own frame.
  it("holds the body to the frame it is being sent under", () => {
    expect(
      prepareForSubmission({ body: draft(), noticeKind: "copyright", approverName: "Dana Reeve" }).ok,
    ).toBe(false);
  });
});
