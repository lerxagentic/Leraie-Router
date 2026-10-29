import { describe, it, expect } from "bun:test";
import {
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  generateBackupCodes,
  hashBackupCode,
  base32Encode,
  base32Decode,
} from "../../src/console/auth/totp";

describe("TOTP Two-Factor Authentication", () => {
  it("encodes and decodes base32 correctly", () => {
    const raw = new TextEncoder().encode("Hello World");
    const encoded = base32Encode(raw);
    const decoded = base32Decode(encoded);
    expect(new TextDecoder().decode(decoded)).toBe("Hello World");
  });

  it("generates a valid 6-digit TOTP code and verifies it", () => {
    const secret = generateTotpSecret();
    const code = generateTotpCode(secret);
    expect(code).toMatch(/^\d{6}$/);

    const isValid = verifyTotpCode(secret, code);
    expect(isValid).toBe(true);

    const isInvalid = verifyTotpCode(secret, "000000");
    // Unless code happened to be 000000
    if (code !== "000000") {
      expect(isInvalid).toBe(false);
    }
  });

  it("generates 10 backup codes with format XXXX-XXXX", () => {
    const codes = generateBackupCodes(10);
    expect(codes).toHaveLength(10);
    for (const c of codes) {
      expect(c).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(hashBackupCode(c)).toHaveLength(64); // sha256 hex length
    }
  });
});
