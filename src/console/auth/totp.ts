/**
 * Two-Factor Authentication (TOTP - RFC 6238) for Lerx Router Console (9Router Pro parity).
 *
 * Implements HMAC-SHA1 and Base32 with zero external dependencies (Node.js crypto).
 * Supports standard authenticator apps (Google Authenticator, Aegis, 1Password)
 * and one-time SHA-256 backup codes.
 */
import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import type { CartethyiaDatabase } from "../../persistence/postgres";
import { consoleSettings } from "../../persistence/schema";
import { eq } from "drizzle-orm";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  while (out.length % 8 !== 0) out += "=";
  return out;
}

export function base32Decode(str: string): Buffer {
  const clean = String(str || "").replace(/[\s=]/g, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function generateTotpCode(secret: string, timeMs = Date.now(), stepSeconds = 30, digits = 6): string {
  const key = base32Decode(secret);
  const counter = Math.floor(timeMs / 1000 / stepSeconds);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(msg).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(code % 10 ** digits).padStart(digits, "0");
}

export function verifyTotpCode(secret: string, code: string, timeMs = Date.now()): boolean {
  const clean = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  for (const delta of [-1, 0, 1]) {
    try {
      if (timeMs + delta * 30 * 1000 < 0) continue;
      const expected = generateTotpCode(secret, timeMs + delta * 30 * 1000);
      if (clean.length === expected.length && timingSafeEqual(Buffer.from(clean), Buffer.from(expected))) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

const BACKUP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateBackupCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let code = "";
    const bytes = randomBytes(8);
    for (const b of bytes) code += BACKUP_ALPHABET[b % BACKUP_ALPHABET.length];
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  return codes;
}

export function hashBackupCode(code: string): string {
  return createHash("sha256").update(String(code).replace(/[\s-]/g, "").toUpperCase()).digest("hex");
}

export function generateOtpauthUrl(secret: string, account = "admin", issuer = "Lerx Router"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export interface TotpConfig {
  enabled: boolean;
  secret: string;
  backupHashes: string[];
  pendingSecret?: string | undefined;
  pendingBackupHashes?: string[] | undefined;
  createdAt?: string | undefined;
}

export async function getTenantTotpConfig(db: CartethyiaDatabase, tenantId: string): Promise<TotpConfig> {
  const [row] = await db
    .select({ preferences: consoleSettings.preferences })
    .from(consoleSettings)
    .where(eq(consoleSettings.tenantId, tenantId))
    .limit(1);
  const prefs = (row?.preferences as Record<string, unknown>) ?? {};
  const totp = (prefs["totp"] as TotpConfig) ?? {};
  return {
    enabled: totp.enabled === true,
    secret: totp.secret ?? "",
    backupHashes: Array.isArray(totp.backupHashes) ? totp.backupHashes : [],
    pendingSecret: totp.pendingSecret ?? "",
    pendingBackupHashes: Array.isArray(totp.pendingBackupHashes) ? totp.pendingBackupHashes : [],
    createdAt: totp.createdAt ?? undefined,
  };
}

export async function saveTenantTotpConfig(
  db: CartethyiaDatabase,
  tenantId: string,
  config: TotpConfig,
): Promise<void> {
  const [row] = await db
    .select({ preferences: consoleSettings.preferences })
    .from(consoleSettings)
    .where(eq(consoleSettings.tenantId, tenantId))
    .limit(1);
  const prefs = (row?.preferences as Record<string, unknown>) ?? {};
  const nextPrefs = {
    ...prefs,
    totp: config,
  };
  await db
    .insert(consoleSettings)
    .values({ tenantId, preferences: nextPrefs as any })
    .onConflictDoUpdate({
      target: consoleSettings.tenantId,
      set: { preferences: nextPrefs as any, updatedAt: new Date() },
    });
}
