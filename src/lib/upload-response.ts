/**
 * Vercel refuses a request body over 4.5 MB before the app runs, answering with
 * a plain-text 413 rather than our JSON. Read that as the caller's size message,
 * so it never surfaces as a parse failure or a generic error. Our own routes also
 * answer 413, as JSON, and their more specific message wins. Any other status
 * reads as usual: a non-JSON answer still throws, for the caller's generic error.
 */
export async function readUploadResponse<T extends { error?: string }>(response: Response, tooLarge: string): Promise<T> {
  if (response.status !== 413) return (await response.json()) as T;
  const data = (await response.json().catch(() => null)) as T | null;
  return data ?? ({ error: tooLarge } as T);
}
