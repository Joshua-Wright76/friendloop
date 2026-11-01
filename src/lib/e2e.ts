/**
 * Test seams are opt-in and narrowly scoped, never a feature.
 *
 * `x-e2e-now` moves the clock and `x-e2e-email-transport` chooses the mail
 * transport, both only for a request that asks. A deployment that inherits
 * `E2E=1` by accident must not hand callers either one, so a Vercel production
 * deployment refuses both regardless of the variable.
 */
export function e2eSeamsAllowed(): boolean {
  return process.env.E2E === "1" && process.env.VERCEL_ENV !== "production";
}
