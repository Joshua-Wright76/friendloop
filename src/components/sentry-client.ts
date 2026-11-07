/**
 * The browser's Sentry, loaded once the page is idle instead of with it.
 *
 * The SDK is about 120 KB compressed. On a phone on 4G that is most of a second of
 * bandwidth shared with the page's own CSS and code, on every first visit, to load
 * something that has nothing to do until something goes wrong. So it now loads
 * after the page, and errors raised before then are held and sent once it is up.
 * No DSN at build time means nothing loads at all.
 */
import { sentryOptions } from "@/lib/sentry-options";

type Sentry = typeof import("@sentry/nextjs");

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
/** Errors from before the SDK arrived. Bounded: a loop that throws must not grow it forever. */
const early: unknown[] = [];
const EARLY_LIMIT = 20;
let loading: Promise<Sentry | null> | null = null;
let loaded: Sentry | null = null;

export function loadSentry(): Promise<Sentry | null> {
  const options = sentryOptions({ dsn: DSN, environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT });
  if (!options) return Promise.resolve(null);
  loading ??= import("@sentry/nextjs").then((sdk) => {
    sdk.init(options);
    loaded = sdk;
    for (const error of early.splice(0)) sdk.captureException(error);
    return sdk;
  }).catch(() => null);
  return loading;
}

/** For error boundaries: reports now if the SDK is up, or as soon as it is. */
export function reportError(error: unknown): void {
  if (!DSN) return;
  if (loaded) {
    loaded.captureException(error);
    return;
  }
  if (early.length < EARLY_LIMIT) early.push(error);
  void loadSentry();
}

/** Called before the app runs: holds uncaught errors, then loads the SDK when the page is idle. */
export function startSentryWhenIdle(): void {
  if (!DSN || typeof window === "undefined") return;
  const hold = (error: unknown) => {
    if (!loaded && early.length < EARLY_LIMIT) early.push(error);
  };
  const onError = (event: ErrorEvent) => hold(event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) => hold(event.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  const start = () => {
    const go = () => void loadSentry().then(() => {
      // The SDK installs its own global handlers in init; ours would double-report.
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    });
    // Measured against starting it eagerly and five seconds later (perf/LOG.md):
    // the first idle moment was best on a phone, and none was free on a laptop.
    if ("requestIdleCallback" in window) window.requestIdleCallback(go, { timeout: 4000 });
    else setTimeout(go, 1500);
  };
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}

/** Navigation tracing, once the SDK is up. Navigations before then go untraced. */
export function routerTransitionStart(...args: Parameters<Sentry["captureRouterTransitionStart"]>): void {
  loaded?.captureRouterTransitionStart(...args);
}
