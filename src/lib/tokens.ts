import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 32 random bytes, url-safe. Used for reply links, share links, sessions. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Short, human-readable code for confirming destructive actions. */
export function confirmPhrase(name: string): string {
  return name.trim();
}
