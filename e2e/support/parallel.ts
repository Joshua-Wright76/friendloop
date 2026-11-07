/**
 * Every test empties the database, so two tests can only run at once if they don't
 * share one. Each Playwright worker gets its own: database, app server and mail-stub
 * mailbox, all found from its `parallelIndex`. The build is shared.
 *
 * `scripts/e2e-db.mjs run` picks the worker count and free ports. Set `E2E_WORKERS=1`
 * to run one at a time, and use it instead of `--workers`, which can't start servers.
 */
export const WORKERS = Math.max(1, Number(process.env.E2E_WORKERS ?? 1) || 1);

/** The worker this process is, or null in the runner, which sets everything up. */
export function currentWorker(): number | null {
  const index = process.env.TEST_PARALLEL_INDEX;
  return index === undefined ? null : Number(index);
}

const PORTS = process.env.E2E_PORTS?.split(",").map(Number);
const FIRST_PORT = Number(process.env.E2E_PORT ?? 3100);

export function workerPort(worker: number): number {
  return PORTS?.[worker] ?? FIRST_PORT + worker;
}

/** Worker 0 keeps the database it was given, so a one-worker run is what it always was. */
export function workerDatabaseUrl(base: string, worker: number): string {
  if (worker === 0) return base;
  const url = new URL(base);
  url.pathname = `${url.pathname}_w${worker}`;
  return url.toString();
}

export function workerDatabaseName(base: string, worker: number): string {
  return new URL(workerDatabaseUrl(base, worker)).pathname.slice(1);
}
