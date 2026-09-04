// Password hashing using Node crypto scrypt + 16-byte salt.
// Format: "saltHex:hashHex" (both lowercase hex).
// No external bcrypt dependency.
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const SALT_BYTES = 16;
const KEY_BYTES = 64; // 512-bit derived key
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

export function hashPassword(plain: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(plain, salt, KEY_BYTES, SCRYPT_PARAMS);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  if (!stored || typeof stored !== "string") return false;
  const sep = stored.indexOf(":");
  if (sep === -1) return false;
  const saltHex = stored.slice(0, sep);
  const hashHex = stored.slice(sep + 1);
  let salt: Buffer;
  let expectedHash: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expectedHash = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expectedHash.length === 0) return false;
  const derived = scryptSync(plain, salt, expectedHash.length, SCRYPT_PARAMS);
  if (derived.length !== expectedHash.length) return false;
  return timingSafeEqual(derived, expectedHash);
}
