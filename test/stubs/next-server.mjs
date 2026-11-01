/**
 * `connection()` only exists to mark a render as request-time work. It throws
 * when called outside a request, and the app has to survive that.
 */
export async function connection() {
  if (globalThis.__CONNECTION_BROKEN__) throw new Error("connection() outside a request");
}
