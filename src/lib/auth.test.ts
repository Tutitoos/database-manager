import { describe, it, expect } from "vitest";
import { extractAuthCode, SUPPORTED_PROVIDERS } from "./auth";

describe("extractAuthCode", () => {
  it("extracts code from a valid callback URL", () => {
    expect(extractAuthCode("database-manager://auth/callback?code=abc123")).toBe("abc123");
  });

  it("returns null if code param is missing", () => {
    expect(extractAuthCode("database-manager://auth/callback?state=xyz")).toBe(null);
  });

  it("returns null for malformed URLs", () => {
    expect(extractAuthCode("not a url")).toBe(null);
    expect(extractAuthCode("")).toBe(null);
  });

  it("handles URL-encoded codes", () => {
    expect(extractAuthCode("dbm://x?code=ab%2Bcd%3D")).toBe("ab+cd=");
  });
});

describe("SUPPORTED_PROVIDERS", () => {
  it("includes the canonical four", () => {
    expect(SUPPORTED_PROVIDERS).toEqual(["discord", "github", "google", "microsoft"]);
  });
});
