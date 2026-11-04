/**
 * Server logging: one JSON line per event, so Vercel's log search can filter on
 * fields, and every `error` also goes to Sentry (a no-op when no DSN is set).
 *
 * Context is for identifiers (`issueId`, `route`), never for what people wrote:
 * logs and error reports are read by whoever runs the instance, not the loop.
 */
import * as Sentry from "@sentry/nextjs";

export type LogContext = Record<string, string | number | boolean | null | undefined>;
type Level = "info" | "warn" | "error";

function describe(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: typeof error, message: String(error) };
}

function emit(level: Level, message: string, context: LogContext, error?: unknown): void {
  const line = JSON.stringify({
    level,
    message,
    ...context,
    ...(error === undefined ? {} : { error: describe(error) }),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info(message: string, context: LogContext = {}): void {
    emit("info", message, context);
  },

  warn(message: string, context: LogContext = {}): void {
    emit("warn", message, context);
  },

  /** Logs and reports. `error` is what was caught; without one the message itself is reported. */
  error(message: string, error?: unknown, context: LogContext = {}): void {
    emit("error", message, context, error);
    Sentry.captureException(error ?? new Error(message), {
      extra: { message, ...context },
    });
  },
};
