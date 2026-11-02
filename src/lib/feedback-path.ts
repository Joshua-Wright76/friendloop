// Pure, so it can be tested without a database.

/**
 * The page they were on, kept useful and harmless: a bare path with no query
 * (which can carry a share or sign-in token) and no reply token (a credential).
 */
export function redactPath(raw: string): string {
  let pathname = "/";
  try {
    pathname = new URL(raw, "http://friendloop.invalid").pathname;
  } catch {
    // A malformed path is stored as the root rather than refusing the note.
  }
  return pathname
    .replace(/^\/(r|s)\/[^/]+/, "/$1/…")
    .slice(0, 200);
}
