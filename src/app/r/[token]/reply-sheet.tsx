"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Deadline } from "@/lib/schedule";

type SaveResult = { ok: true; savedAt: string } | { ok: false; error: string };

async function post(token: string, payload: Record<string, unknown>): Promise<SaveResult> {
  const response = await fetch(`/api/reply/${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await response.json()) as { ok?: boolean; savedAt?: string; error?: string };
  if (!response.ok || !data.ok) return { ok: false, error: data.error ?? "Something went wrong." };
  return { ok: true, savedAt: data.savedAt ?? "" };
}

export type SheetQuestion = {
  id: string;
  index: number;
  text: string;
  body: string;
  submitted: boolean;
};

type Props = {
  token: string;
  loopName: string;
  roundNumber: number;
  deadline: Deadline;
  displayName: string;
  questions: SheetQuestion[];
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function ReplySheet({
  token,
  loopName,
  roundNumber,
  deadline,
  displayName,
  questions,
}: Props) {
  const [bodies, setBodies] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map((question) => [question.id, question.body])),
  );
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [sent, setSent] = useState(() => questions.some((question) => question.submitted));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const fields = useRef(new Map<string, HTMLTextAreaElement>());

  const total = questions.length;
  const answered = useMemo(
    () => Object.values(bodies).filter((body) => body.trim().length > 0).length,
    [bodies],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const autosize = useCallback((element: HTMLTextAreaElement) => {
    element.style.height = "auto";
    element.style.height = `${Math.max(element.scrollHeight, 72)}px`;
  }, []);

  const persist = useCallback(
    async (questionId: string, body: string) => {
      setStatus("saving");
      const result = await post(token, { action: "draft", issueQuestionId: questionId, body });
      if (result.ok) {
        setStatus("saved");
        setError(null);
      } else {
        setStatus("error");
        setError(result.error);
      }
    },
    [token],
  );

  const onChange = useCallback(
    (questionId: string, value: string, element: HTMLTextAreaElement) => {
      setBodies((current) => ({ ...current, [questionId]: value }));
      autosize(element);

      const existing = timers.current.get(questionId);
      if (existing) clearTimeout(existing);
      timers.current.set(
        questionId,
        setTimeout(() => {
          timers.current.delete(questionId);
          void persist(questionId, value);
        }, 550),
      );
    },
    [autosize, persist],
  );

  const onSend = useCallback(async () => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    setSending(true);
    setError(null);

    for (const question of questions) {
      const body = bodies[question.id] ?? "";
      if (body.trim().length > 0) {
        await post(token, { action: "draft", issueQuestionId: question.id, body });
      }
    }

    const result = await post(token, { action: "submit" });

    setSending(false);

    if (!result.ok) {
      setError(result.error);
      setStatus("error");
      return;
    }

    setSent(true);
    setStatus("saved");
  }, [bodies, questions, token]);

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-line bg-page/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-[560px] items-center justify-between gap-3 px-4">
          <span className="truncate text-[14px] font-medium text-ink-soft">{loopName}</span>
          <span className="flex h-7 items-center rounded-full border border-line bg-card px-3 text-[12px] font-medium text-ink-soft numeric">
            {total} {total === 1 ? "question" : "questions"}
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[560px] px-4 pb-36 pt-6">
        <h1 className="text-[30px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink">
          Round {roundNumber}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
          Closes {deadline.inLoopZone}
          {deadline.inViewerZone ? ` (${deadline.inViewerZone} where you are)` : ""}.
        </p>

        {sent ? (
          <div className="settle mt-5 flex items-start gap-3 rounded-xl border border-accent-line bg-accent-soft px-4 py-3">
            <svg viewBox="0 0 20 20" aria-hidden className="mt-0.5 h-4 w-4 flex-none fill-accent">
              <path d="M10 1.7a8.3 8.3 0 100 16.6 8.3 8.3 0 000-16.6zm3.8 6.4l-4.4 4.7a.9.9 0 01-1.3 0L6.2 10.9a.9.9 0 111.3-1.3l1.2 1.3 3.8-4a.9.9 0 011.3 1.2z" />
            </svg>
            <p className="text-[14px] leading-relaxed text-accent-ink">
              Sent. You can change these until {deadline.inLoopZone}.
            </p>
          </div>
        ) : null}

        <div className="mt-5 flex flex-col gap-3">
          {questions.map((question) => (
            <label key={question.id} className="card block p-4">
              <span className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-field text-[11px] font-semibold text-ink-muted numeric"
                >
                  {question.index}
                </span>
                <span className="text-[16px] font-semibold leading-snug tracking-[-0.01em] text-ink">
                  {question.text}
                </span>
              </span>

              <textarea
                ref={(element) => {
                  if (element) {
                    fields.current.set(question.id, element);
                    autosize(element);
                  }
                }}
                value={bodies[question.id] ?? ""}
                onChange={(event) => onChange(question.id, event.target.value, event.currentTarget)}
                onFocus={(event) => autosize(event.currentTarget)}
                rows={2}
                maxLength={8000}
                placeholder="A sentence is plenty."
                aria-label={question.text}
                className="field mt-3"
              />
            </label>
          ))}
        </div>

        {error ? (
          <p role="alert" className="mt-4 text-[14px] leading-relaxed text-danger">
            {error}
          </p>
        ) : null}

        <p aria-live="polite" className="mt-4 h-5 text-[13px] text-ink-muted">
          {status === "saving" ? "Saving…" : null}
          {status === "saved" ? (sent ? "Saved" : "Draft saved") : null}
          {status === "error" ? "Not saved — check your connection" : null}
        </p>

        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          {displayName}, only the people in {loopName} will read this.
        </p>
      </main>

      <div
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card/95 backdrop-blur-md"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto flex w-full max-w-[560px] items-center justify-between gap-3 px-4 pt-3">
          <span className="text-[13px] font-medium text-ink-soft numeric">
            {sent ? "Sent" : `${answered} of ${total} answered`}
          </span>
          <button
            type="button"
            onClick={onSend}
            disabled={sending || (!sent && answered === 0)}
            className="btn btn-primary"
          >
            {sending ? "Sending…" : sent ? "Save changes" : "Send answers"}
          </button>
        </div>
      </div>
    </>
  );
}
