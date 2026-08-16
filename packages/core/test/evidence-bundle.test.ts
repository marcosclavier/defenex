import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { buildEvidenceBundle } from "../src/evidence/bundle.js";
import { artifactOf, jsonArtifact } from "../src/evidence/capture.js";
import { parseRdapDomain, parseRdapIp } from "../src/enrich/rdap.js";

const screenshot = Buffer.from("\x89PNG\r\n\x1a\n-not-really-a-png-but-bytes-are-bytes");
const html = Buffer.from("<html><body>replica yeti cooler $34</body></html>", "utf8");

function bundle(overrides: Partial<Parameters<typeof buildEvidenceBundle>[0]> = {}) {
  return buildEvidenceBundle({
    takedownId: "11111111-1111-1111-1111-111111111111",
    findingId: "22222222-2222-2222-2222-222222222222",
    brandId: "33333333-3333-3333-3333-333333333333",
    capture: {
      capturedAt: "2026-08-15T12:00:00.000Z",
      requestedUrl: "https://www.dhgate.com/wholesale/replica+yeti+cooler.html",
      finalUrl: "https://www.dhgate.com/wholesale/replica+yeti+cooler.html",
      httpStatus: 200,
      pageTitle: "Replica Yeti Cooler",
      screenshotFullPage: true,
      responseHeaders: { "content-type": "text/html; charset=utf-8" },
      artifacts: [
        artifactOf("screenshot.png", "image/png", screenshot),
        artifactOf("page.html", "text/html", html),
        jsonArtifact("response.json", { httpStatus: 200 }),
      ],
    },
    ...overrides,
  });
}

describe("buildEvidenceBundle", () => {
  it("archives every artifact plus the manifest", () => {
    const files = unzipSync(bundle().zip);
    expect(Object.keys(files).sort()).toEqual([
      "manifest.json",
      "page.html",
      "response.json",
      "screenshot.png",
    ]);
  });

  // The whole point of the manifest: a recipient can recompute the digests and
  // see the bundle is the one that was captured.
  it("every manifest hash matches the archived bytes", () => {
    const { zip, manifest } = bundle();
    const files = unzipSync(zip);
    expect(manifest.artifacts.length).toBeGreaterThan(0);
    for (const entry of manifest.artifacts) {
      const bytes = files[entry.name];
      expect(bytes, `missing ${entry.name}`).toBeDefined();
      expect(createHash("sha256").update(bytes!).digest("hex")).toBe(entry.sha256);
      expect(bytes!.byteLength).toBe(entry.sizeBytes);
    }
  });

  it("round-trips the archived bytes unchanged", () => {
    const files = unzipSync(bundle().zip);
    expect(Buffer.from(files["screenshot.png"]!).equals(screenshot)).toBe(true);
    expect(strFromU8(files["page.html"]!)).toBe(html.toString("utf8"));
  });

  it("hashes the archive itself so it cannot be silently regenerated", () => {
    const { zip, sha256 } = bundle();
    expect(sha256).toBe(createHash("sha256").update(zip).digest("hex"));
  });

  // A hash that changes on every rebuild proves nothing, so mtime is pinned.
  it("is byte-identical for identical input", () => {
    expect(bundle().sha256).toBe(bundle().sha256);
  });

  it("carries the registrar and host contacts a notice needs an addressee for", () => {
    const rdapDomain = parseRdapDomain(
      {
        ldhName: "DHGATE.COM",
        entities: [
          {
            roles: ["registrar"],
            publicIds: [{ identifier: "1599" }],
            vcardArray: ["vcard", [["fn", {}, "text", "Alibaba Cloud"]]],
            entities: [
              { roles: ["abuse"], vcardArray: ["vcard", [["email", {}, "text", "abuse@alibaba.com"]]] },
            ],
          },
        ],
      },
      "dhgate.com",
    );
    const rdapIp = parseRdapIp(
      {
        name: "CLOUDFLARENET",
        entities: [{ roles: ["abuse"], vcardArray: ["vcard", [["email", {}, "text", "abuse@cloudflare.com"]]] }],
      },
      "104.18.2.1",
    );

    const { zip, manifest } = bundle({ rdapDomain, rdapIp });
    expect(manifest.registrar).toMatchObject({ name: "Alibaba Cloud", ianaId: "1599", abuseEmail: "abuse@alibaba.com" });
    expect(manifest.host).toMatchObject({ ip: "104.18.2.1", abuseEmail: "abuse@cloudflare.com" });

    // The registry's own response is archived whole, not just our reading of it.
    const files = unzipSync(zip);
    expect(files["rdap-domain.json"]).toBeDefined();
    expect(files["rdap-ip.json"]).toBeDefined();
    expect(manifest.artifacts.map((a) => a.name)).toContain("rdap-domain.json");
  });

  it("records why a lookup is missing rather than leaving a silent null", () => {
    const { manifest } = bundle({ lookupErrors: ["rdap 404 for /domain/dhgate.com"] });
    expect(manifest.registrar).toBeNull();
    expect(manifest.lookupErrors).toEqual(["rdap 404 for /domain/dhgate.com"]);
  });
});
