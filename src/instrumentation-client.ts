import { routerTransitionStart, startSentryWhenIdle } from "@/components/sentry-client";

/**
 * Browser error tracking. No-op unless NEXT_PUBLIC_SENTRY_DSN is set at build
 * time. No session replay: the pages are people's private writing. The SDK loads
 * once the page is idle; see src/components/sentry-client.ts for why.
 */
startSentryWhenIdle();

export const onRouterTransitionStart = routerTransitionStart;
