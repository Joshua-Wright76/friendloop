"use client";

import { useState } from "react";
import { copy, text } from "@/lib/copy";

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

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
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
        setError(payload.error ?? copy.suggest.errors.generic);
      }
    } catch {
      setError(copy.suggest.errors.generic);
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="mt-5" role="status">
        <p className="text-[15px] font-semibold text-ink">{copy.suggest.doneTitle}</p>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.suggest.doneBody}</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-5">
      <label htmlFor="suggestion-text" className="text-[13px] font-medium text-ink">
        {copy.suggest.fieldLabel}
      </label>
      <textarea
        id="suggestion-text"
        name="text"
        required
        maxLength={200}
        rows={3}
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder={copy.suggest.placeholder}
        className="field lined-field mt-1.5 w-full py-2"
      />

      <fieldset className="mt-4">
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

      {error ? (
        <p role="alert" className="mt-3 text-[13.5px] leading-relaxed text-danger">
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={sending || question.trim().length === 0} className="btn btn-primary mt-4">
        {sending ? copy.suggest.sending : copy.suggest.submit}
      </button>
    </form>
  );
}
