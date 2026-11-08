"use client";

import { useEffect, useRef, useState } from "react";
import { copy, text } from "@/lib/copy";
import { FieldLabel } from "@/components/field-label";

type Props = { token: string; displayName: string };

/**
 * The reply sheet's sibling: suggest a question for a future round. Posts JSON
 * to the suggestion endpoint, then swaps itself for the quiet confirmation.
 */
export function SuggestForm({ token, displayName }: Props) {
  const [question, setQuestion] = useState("");
  const [authorDisplay, setAuthorDisplay] = useState<"name" | "anonymous">("name");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const done = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  // The form is replaced by the confirmation, so keyboard focus moves with it.
  useEffect(() => {
    if (sent) done.current?.focus();
  }, [sent]);

  // Which control the current error is about; other errors name no field.
  const errorField =
    error === copy.suggest.errors.text ? "text" : error === copy.suggest.errors.authorDisplay ? "authorDisplay" : null;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    if (question.trim().length === 0) {
      setError(copy.suggest.errors.text);
      field.current?.focus();
      return;
    }
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/suggest/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: question, authorDisplay }),
      });
      if (response.ok) {
        setSent(true);
      } else {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        const message = payload.error ?? copy.suggest.errors.generic;
        setError(message);
        if (message === copy.suggest.errors.text) field.current?.focus();
      }
    } catch {
      setError(copy.suggest.errors.generic);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {/* One confirmation, seen and heard: it takes focus, so it's read out once. */}
      {sent ? (
        <div ref={done} tabIndex={-1} role="status" className="notice settle mt-5 flex items-start gap-3 border bg-accent-soft px-4 py-3 outline-offset-4">
          <svg viewBox="0 0 20 20" aria-hidden="true" className="sent-stamp mt-0.5 h-5 w-5 flex-none"><path d="M10 1.7a8.3 8.3 0 100 16.6 8.3 8.3 0 000-16.6zm3.8 6.4l-4.4 4.7a.9.9 0 01-1.3 0L6.2 10.9a.9.9 0 111.3-1.3l1.2 1.3 3.8-4a.9.9 0 011.3 1.2z" /></svg>
          <div>
            <p className="text-[15px] font-extrabold text-ink">{copy.suggest.doneTitle}</p>
            <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.suggest.doneBody}</p>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-5">
          <label htmlFor="suggestion-text" className="block">
            <FieldLabel required>{copy.suggest.fieldLabel}</FieldLabel>
          </label>
          <textarea
            ref={field}
            id="suggestion-text"
            name="text"
            required
            maxLength={200}
            rows={3}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            aria-invalid={errorField === "text" ? "true" : undefined}
            aria-describedby={errorField === "text" ? "suggestion-error" : undefined}
            placeholder={copy.suggest.placeholder}
            className="field lined-field mt-1.5 w-full py-2"
          />

          <fieldset className="mt-4" aria-describedby={errorField === "authorDisplay" ? "suggestion-error" : undefined}>
            <legend className="text-[13px] font-medium text-ink">{copy.suggest.creditTitle}</legend>
            <div className="mt-1.5 flex flex-col gap-2">
              <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-line px-3 py-2.5 text-[14px] leading-snug text-ink has-checked:border-accent has-checked:bg-accent-soft">
                <input
                  type="radio"
                  name="authorDisplay"
                  value="name"
                  checked={authorDisplay === "name"}
                  onChange={() => setAuthorDisplay("name")}
                  className="mt-0.5 accent-accent"
                />
                <span>
                  {copy.suggest.creditName}
                  <span className="mt-0.5 block text-[12.5px] leading-relaxed text-ink-muted">
                    {text(copy.suggest.creditNameHint, { name: displayName })}
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-line px-3 py-2.5 text-[14px] leading-snug text-ink has-checked:border-accent has-checked:bg-accent-soft">
                <input
                  type="radio"
                  name="authorDisplay"
                  value="anonymous"
                  checked={authorDisplay === "anonymous"}
                  onChange={() => setAuthorDisplay("anonymous")}
                  className="mt-0.5 accent-accent"
                />
                <span>
                  {copy.suggest.creditAnonymous}
                  <span className="mt-0.5 block text-[12.5px] leading-relaxed text-ink-muted">
                    {copy.suggest.creditAnonymousHint}
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          <p id="suggestion-error" role="alert" className={error ? "mt-3 text-[13.5px] leading-relaxed text-danger" : undefined}>
            {error}
          </p>

          {/* aria-disabled, not disabled: pressing Send must not drop keyboard focus. */}
          <button
            type="submit"
            aria-disabled={sending || question.trim().length === 0 ? true : undefined}
            className="btn btn-primary mt-4 aria-disabled:cursor-not-allowed"
          >
            {sending ? copy.suggest.sending : copy.suggest.submit}
          </button>
          {question.trim().length === 0 ? <p className="m-0 mt-2 text-[13px] text-ink-soft">{copy.suggest.writeFirst}</p> : null}
        </form>
      )}
    </>
  );
}
