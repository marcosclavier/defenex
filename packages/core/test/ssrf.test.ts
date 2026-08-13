import { describe, it, expect } from "vitest";
import { blockedIpReason, assertUrlIsFetchable } from "../src/enrich/ssrf.js";
import { BlockedUrlError } from "../src/errors.js";

describe("blockedIpReason", () => {
  it("blocks the cloud metadata endpoint", () => {
    expect(blockedIpReason("169.254.169.254")).toBe("link-local / cloud metadata");
  });

  it.each([
    ["127.0.0.1", "loopback"],
    ["10.1.2.3", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.168.1.1", "private"],
    ["100.64.0.1", "carrier-grade-nat"],
    ["0.0.0.0", "this-network"],
    ["224.0.0.1", "multicast"],
  ])("blocks %s", (ip, reason) => {
    expect(blockedIpReason(ip)).toBe(reason);
  });

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "11.0.0.1"])(
    "allows public address %s",
    (ip) => {
      expect(blockedIpReason(ip)).toBeNull();
    },
  );

  it("blocks IPv6 loopback and link-local", () => {
    expect(blockedIpReason("::1")).toBe("loopback");
    expect(blockedIpReason("fe80::1")).toBe("link-local");
    expect(blockedIpReason("fc00::1")).toBe("unique-local");
  });

  it("judges IPv4-mapped IPv6 on the embedded address", () => {
    expect(blockedIpReason("::ffff:127.0.0.1")).toBe("loopback");
    expect(blockedIpReason("::ffff:169.254.169.254")).toBe("link-local / cloud metadata");
    expect(blockedIpReason("::ffff:8.8.8.8")).toBeNull();
  });
});

describe("assertUrlIsFetchable", () => {
  it.each([
    "file:///etc/passwd",
    "gopher://evil.test/",
    "javascript:alert(1)",
  ])("refuses scheme in %s", async (url) => {
    await expect(assertUrlIsFetchable(url)).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("refuses embedded credentials", async () => {
    await expect(assertUrlIsFetchable("http://user:pass@example.com/")).rejects.toBeInstanceOf(
      BlockedUrlError,
    );
  });

  it.each([
    "http://localhost:8080/admin",
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://192.168.0.1/",
    "http://[::1]/",
  ])("refuses internal target %s", async (url) => {
    await expect(assertUrlIsFetchable(url)).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("refuses unparseable input", async () => {
    await expect(assertUrlIsFetchable("not a url")).rejects.toBeInstanceOf(BlockedUrlError);
  });
});
