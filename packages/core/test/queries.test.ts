import { describe, it, expect } from "vitest";
import { buildQueries } from "../src/queries/templates.js";
import type { ScanInput } from "@defenex/shared";

const input: ScanInput = {
  brand: "Acme Tools",
  domain: "acmetools.com",
  industry: "software",
  aliases: ["AcmeTool"],
  allowlistDomains: [],
};

describe("buildQueries", () => {
  it("respects the query budget", () => {
    expect(buildQueries(input, 5)).toHaveLength(5);
    expect(buildQueries(input, 100).length).toBeGreaterThan(10);
  });

  it("returns highest-priority queries first when the budget is tight", () => {
    const queries = buildQueries(input, 3);
    expect(queries.every((q) => q.kind === "marketplace")).toBe(true);
  });

  it("uses the industry vocabulary pack", () => {
    const all = buildQueries(input, 100).map((q) => q.q).join(" ");
    expect(all).toContain("crack");
    expect(all).not.toContain("replica"); // that is the fashion pack
  });

  it("excludes the brand's own domain from open-web queries", () => {
    const open = buildQueries(input, 100).filter((q) => !q.q.startsWith("site:"));
    expect(open.every((q) => q.q.includes("-site:acmetools.com"))).toBe(true);
  });

  it("strips quotes from the brand name so the query stays well formed", () => {
    const evil = { ...input, brand: 'Acme" OR "x' };
    const queries = buildQueries(evil, 100);
    expect(queries.every((q) => (q.q.match(/"/g) ?? []).length % 2 === 0)).toBe(true);
  });

  it("is deterministic", () => {
    expect(buildQueries(input, 20)).toEqual(buildQueries(input, 20));
  });
});
