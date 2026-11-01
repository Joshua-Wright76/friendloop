/**
 * The suite's one clock.
 *
 * Every fixture, sweep, and page assertion is built on these instants, so the
 * suite never depends on the real date. Kept free of Playwright imports so the
 * database-backed unit tests can share the exact same fixtures.
 */
export const DAY = 24 * 60 * 60 * 1000;
export const HOUR = 60 * 60 * 1000;

/** Thursday 07:59 UTC — the minute before a Friday 09:00 Amsterdam slot. */
export const BEFORE_FIRST_SLOT = new Date("2026-01-01T07:59:00Z");
export const AFTER_FIRST_SLOT = new Date("2026-01-02T08:05:00Z");
export const DELIVERY_DAY = new Date("2026-01-09T08:05:00Z");

/** Every fixture is built on this instant, so no seed reads the real clock. */
export const E2E_NOW = AFTER_FIRST_SLOT;
