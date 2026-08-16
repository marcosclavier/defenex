import { describe, it, expect, vi } from "vitest";
import { parseRdapDomain, parseRdapIp, registrableDomain } from "../src/enrich/rdap.js";

/** Shape returned by Verisign's RDAP server, trimmed to what we read. */
const domainResponse = {
  objectClassName: "domain",
  ldhName: "DHGATE.COM",
  status: ["client transfer prohibited", "client delete prohibited"],
  events: [
    { eventAction: "registration", eventDate: "2004-03-15T05:00:00Z" },
    { eventAction: "expiration", eventDate: "2027-03-15T05:00:00Z" },
    { eventAction: "last changed", eventDate: "2024-02-01T00:00:00Z" },
  ],
  nameservers: [{ ldhName: "NS1.DNSV5.COM" }, { ldhName: "NS2.DNSV5.COM" }],
  entities: [
    {
      objectClassName: "entity",
      handle: "1599",
      roles: ["registrar"],
      publicIds: [{ type: "IANA Registrar ID", identifier: "1599" }],
      vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Alibaba Cloud Computing Ltd."]]],
      entities: [
        {
          roles: ["abuse"],
          vcardArray: [
            "vcard",
            [
              ["fn", {}, "text", "Abuse Department"],
              ["tel", { type: "voice" }, "uri", "tel:+86.4008131688"],
              ["email", {}, "text", "abuse@list.alibaba-inc.com"],
            ],
          ],
        },
      ],
    },
  ],
};

describe("parseRdapDomain", () => {
  const record = parseRdapDomain(domainResponse, "dhgate.com");

  it("lowercases the domain the registry reports", () => {
    expect(record.domain).toBe("dhgate.com");
  });

  it("reads the registrar name and IANA id", () => {
    expect(record.registrar).toBe("Alibaba Cloud Computing Ltd.");
    expect(record.registrarIanaId).toBe("1599");
  });

  // The abuse address is the whole reason we do this lookup: a registrar notice
  // with no addressee cannot be sent.
  it("finds the abuse contact nested under the registrar entity", () => {
    expect(record.registrarAbuse).toEqual({
      name: "Abuse Department",
      email: "abuse@list.alibaba-inc.com",
    });
  });

  it("picks the named events, not merely the first one", () => {
    expect(record.registeredAt).toBe("2004-03-15T05:00:00Z");
    expect(record.expiresAt).toBe("2027-03-15T05:00:00Z");
  });

  it("normalises nameservers", () => {
    expect(record.nameservers).toEqual(["ns1.dnsv5.com", "ns2.dnsv5.com"]);
  });

  it("keeps the untouched response so the registry's own answer is archived", () => {
    expect(record.raw).toBe(domainResponse);
  });

  // Registries vary a lot. A thin response must degrade to nulls rather than throw,
  // because capture continues without RDAP but cannot continue after an exception.
  it("survives a response with no entities or events", () => {
    const thin = parseRdapDomain({ ldhName: "EXAMPLE.NET" }, "example.net");
    expect(thin.registrar).toBeNull();
    expect(thin.registrarAbuse).toBeNull();
    expect(thin.registeredAt).toBeNull();
    expect(thin.statuses).toEqual([]);
    expect(thin.nameservers).toEqual([]);
  });

  it("falls back to the queried domain when the registry omits ldhName", () => {
    expect(parseRdapDomain({}, "example.org").domain).toBe("example.org");
  });

  it("ignores an abuse entity that carries no email", () => {
    const noEmail = parseRdapDomain(
      { entities: [{ roles: ["abuse"], vcardArray: ["vcard", [["fn", {}, "text", "Nobody"]]] }] },
      "x.com",
    );
    expect(noEmail.registrarAbuse).toBeNull();
  });

  it("tolerates a structured vcard value instead of a string", () => {
    const structured = parseRdapDomain(
      {
        entities: [
          {
            roles: ["registrar"],
            vcardArray: ["vcard", [["adr", {}, "text", ["", "", "1 Main St"]], ["fn", {}, "text", "Reg Co"]]],
          },
        ],
      },
      "x.com",
    );
    expect(structured.registrar).toBe("Reg Co");
  });
});

describe("parseRdapIp", () => {
  const ipResponse = {
    objectClassName: "ip network",
    startAddress: "104.16.0.0",
    endAddress: "104.31.255.255",
    name: "CLOUDFLARENET",
    country: "US",
    entities: [
      {
        roles: ["registrant"],
        vcardArray: ["vcard", [["fn", {}, "text", "Cloudflare, Inc."]]],
        entities: [
          {
            roles: ["abuse"],
            vcardArray: ["vcard", [["fn", {}, "text", "Abuse"], ["email", {}, "text", "abuse@cloudflare.com"]]],
          },
        ],
      },
    ],
  };

  it("extracts the operator, range and abuse address", () => {
    const record = parseRdapIp(ipResponse, "104.18.2.1");
    expect(record.operator).toBe("Cloudflare, Inc.");
    expect(record.range).toBe("104.16.0.0 - 104.31.255.255");
    expect(record.networkName).toBe("CLOUDFLARENET");
    expect(record.abuse?.email).toBe("abuse@cloudflare.com");
    expect(record.country).toBe("US");
    // Never taken from the response: it is the address we actually connected to.
    expect(record.ip).toBe("104.18.2.1");
  });

  it("returns nulls for an empty network record", () => {
    const record = parseRdapIp({}, "1.2.3.4");
    expect(record.operator).toBeNull();
    expect(record.abuse).toBeNull();
    expect(record.range).toBeNull();
  });
});

describe("registrableDomain", () => {
  it.each([
    ["https://www.dhgate.com/wholesale/replica+yeti.html", "dhgate.com"],
    ["http://shop.example.com/x?y=1", "example.com"],
    ["EXAMPLE.COM", "example.com"],
    ["example.com.", "example.com"],
    // Asking RDAP for a subdomain returns 404, so the suffix must be handled.
    ["https://shop.example.co.uk/item", "example.co.uk"],
    ["a.b.c.co.jp", "c.co.jp"],
  ])("%s -> %s", (input, expected) => {
    expect(registrableDomain(input)).toBe(expected);
  });

  it.each([
    ["https://192.168.1.1/x"],
    ["localhost"],
    ["co.uk"],
    [""],
    ["https://[::1]/"],
  ])("refuses %s", (input) => {
    expect(registrableDomain(input)).toBeNull();
  });
});

describe("RdapClient routing", () => {
  function stubFetch(seen: string[], failing: RegExp | null = null) {
    return async (input: string | URL): Promise<Response> => {
      const url = String(input);
      seen.push(url);
      if (failing?.test(url)) return new Response("nope", { status: 503 });
      return Response.json({ ldhName: "EXAMPLE.COM" });
    };
  }

  it("goes straight to the registry for a TLD we know, skipping the bootstrap", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", stubFetch(seen));
    const { RdapClient } = await import("../src/enrich/rdap.js");
    await new RdapClient().lookupDomain("https://shop.example.com/x");
    expect(seen).toEqual(["https://rdap.verisign.com/com/v1/domain/example.com"]);
    vi.unstubAllGlobals();
  });

  // The bootstrap exists precisely for a registry that moved or is down.
  it("falls back to the bootstrap when the direct registry fails", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", stubFetch(seen, /verisign/));
    const { RdapClient } = await import("../src/enrich/rdap.js");
    const record = await new RdapClient().lookupDomain("example.com");
    expect(seen).toEqual([
      "https://rdap.verisign.com/com/v1/domain/example.com",
      "https://rdap.org/domain/example.com",
    ]);
    expect(record.domain).toBe("example.com");
    vi.unstubAllGlobals();
  });

  it("uses the bootstrap for a TLD not on the direct list", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", stubFetch(seen));
    const { RdapClient } = await import("../src/enrich/rdap.js");
    await new RdapClient().lookupDomain("example.io");
    expect(seen).toEqual(["https://rdap.org/domain/example.io"]);
    vi.unstubAllGlobals();
  });

  // An explicitly configured base URL is a deliberate override, not a hint.
  it("never second-guesses an explicit baseUrl", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", stubFetch(seen));
    const { RdapClient } = await import("../src/enrich/rdap.js");
    await new RdapClient({ baseUrl: "https://rdap.test/" }).lookupDomain("example.com");
    expect(seen).toEqual(["https://rdap.test/domain/example.com"]);
    vi.unstubAllGlobals();
  });

  it("surfaces a registry error rather than inventing an empty record", async () => {
    vi.stubGlobal("fetch", async () => new Response("gone", { status: 404 }));
    const { RdapClient, RdapError } = await import("../src/enrich/rdap.js");
    await expect(new RdapClient().lookupIp("1.2.3.4")).rejects.toBeInstanceOf(RdapError);
    vi.unstubAllGlobals();
  });
});
