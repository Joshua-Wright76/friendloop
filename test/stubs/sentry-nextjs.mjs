/**
 * `@sentry/nextjs`, in memory.
 *
 * Library code reports to Sentry through the SDK's global client; under
 * `node --test` there is no client to report to. This records what the code
 * asked to send, and runs `withMonitor` callbacks the way the SDK does.
 */
/**
 * @type {{
 *   exceptions: Array<{ error: any; hint: any }>;
 *   monitors: Array<{ slug: string; config: unknown; status: string }>;
 * }}
 */
export const calls = { exceptions: [], monitors: [] };

export function captureException(error, hint) {
  calls.exceptions.push({ error, hint });
  return "event-id";
}

export async function withMonitor(slug, callback, config) {
  const entry = { slug, config, status: "in_progress" };
  calls.monitors.push(entry);
  try {
    const result = await callback();
    entry.status = "ok";
    return result;
  } catch (error) {
    entry.status = "error";
    throw error;
  }
}

export function reset() {
  calls.exceptions.length = 0;
  calls.monitors.length = 0;
}
