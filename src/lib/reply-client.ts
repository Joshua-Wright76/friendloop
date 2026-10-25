export type SaveResult = { ok: true; savedAt: string } | { ok: false; error: string };

export async function postReply(
  token: string,
  payload: Record<string, unknown>,
  genericError: string,
  fetcher: typeof fetch = fetch,
): Promise<SaveResult> {
  try {
    const response = await fetcher(`/api/reply/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await response.json()) as { ok?: boolean; savedAt?: string; error?: string };
    if (!response.ok || !data.ok) return { ok: false, error: data.error ?? genericError };
    return { ok: true, savedAt: data.savedAt ?? "" };
  } catch {
    return { ok: false, error: genericError };
  }
}

/** Keep writes for one question in request order, while allowing other questions to save independently. */
export function createSerialDraftWriter<T>(write: (questionId: string, body: string) => Promise<T>) {
  const pending = new Map<string, Promise<unknown>>();

  return (questionId: string, body: string): Promise<T> => {
    const previous = pending.get(questionId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => write(questionId, body));
    pending.set(questionId, current);

    return current.finally(() => {
      if (pending.get(questionId) === current) pending.delete(questionId);
    });
  };
}
