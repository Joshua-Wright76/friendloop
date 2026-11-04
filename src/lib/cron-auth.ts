/**
 * The bearer check shared by the operational endpoints (`/api/cron/sweep`,
 * `/api/health`). With no `CRON_SECRET` configured nothing is authorized —
 * an unset secret must not mean an open endpoint.
 */
export function isCronAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}
