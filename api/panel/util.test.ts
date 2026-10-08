import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, hashPassword, verifyPassword, verifyTotp } from "./util";

describe("panel authentication utilities", () => {
  it("hashes passwords and rejects an incorrect password", () => {
    const stored = hashPassword("correct horse battery staple");

    expect(stored).toMatch(/^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(verifyPassword("not the password", stored)).toBe(false);
    expect(verifyPassword("anything", "invalid-hash")).toBe(false);
  });

  it("round-trips base32 data and accepts an RFC 6238 SHA-1 test vector", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(base32Encode(base32Decode(secret))).toBe(secret);
    expect(verifyTotp(secret, "287082", 59_000)).toBe(true);
    expect(verifyTotp(secret, "000000", 59_000)).toBe(false);
  });
});
