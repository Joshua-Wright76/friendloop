import { desc } from "drizzle-orm";
import { db } from "@/db";
import { feedback } from "@/db/schema";
import { copy, text } from "@/lib/copy";
import { requireUiPreview } from "@/lib/ui-preview";

export const instant = false;

/**
 * Notes sent from the corner button. Behind the same /dev key as the captured
 * inbox, because a note can carry a name and an address.
 */
export default async function DevFeedbackPage() {
  await requireUiPreview();

  const rows = await db.select().from(feedback).orderBy(desc(feedback.createdAt)).limit(100);

  return (
    <main className="mx-auto w-full max-w-[560px] px-4 pb-24 pt-5">
      <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.025em] text-ink">
        {copy.devFeedback.title}
      </h1>
      <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">{copy.devFeedback.description}</p>
      <p role="note" className="notice mt-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-[13px] leading-relaxed text-danger">
        {copy.devFeedback.warning}
      </p>

      <ul className="mt-5 flex flex-col gap-2.5" aria-label={copy.devFeedback.title}>
        {rows.map((row) => (
          <li key={row.id} className="card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate text-[14px] font-medium text-ink">
                {row.senderName ?? row.senderEmail ?? copy.devFeedback.anonymous}
                {row.senderName && row.senderEmail ? (
                  <span className="ml-1.5 font-normal text-ink-muted">{row.senderEmail}</span>
                ) : null}
              </p>
              <time dateTime={row.createdAt.toISOString()} className="flex-none text-[12px] text-ink-muted">
                {row.createdAt.toISOString().slice(0, 16).replace("T", " ")}
              </time>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{row.message}</p>
            <p className="mt-2 break-all text-[12px] text-ink-muted">
              {row.path}
              {row.viewport ? ` · ${text(copy.devFeedback.viewport, { viewport: row.viewport })}` : ""}
            </p>
            {row.userAgent ? <p className="mt-0.5 break-all text-[11px] text-ink-muted">{row.userAgent}</p> : null}
          </li>
        ))}
        {rows.length === 0 ? (
          <li className="card p-5 text-[14px] text-ink-muted">{copy.devFeedback.empty}</li>
        ) : null}
      </ul>
    </main>
  );
}
