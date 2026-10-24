import { desc } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { outbox } from "@/db/schema";
import { copy } from "@/lib/copy";

export const instant = false;

/**
 * Dev-only inbox.
 *
 * Preview deployments run with EMAIL_TRANSPORT=outbox, so nothing is sent — which
 * would make sign-in impossible. This lists what would have gone out so a magic
 * link can be clicked. It does not exist in production.
 */
export default async function DevOutboxPage() {
  if (process.env.VERCEL_ENV !== "preview") notFound();

  const rows = await db
    .select({
      id: outbox.id,
      to: outbox.to,
      subject: outbox.subject,
      kind: outbox.kind,
      html: outbox.html,
      createdAt: outbox.createdAt,
    })
    .from(outbox)
    .orderBy(desc(outbox.createdAt))
    .limit(25);

  return (
    <main className="mx-auto w-full max-w-[560px] px-4 pb-16 pt-5">
      <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.025em] text-ink">
        {copy.devOutbox.title}
      </h1>
      <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">
        {copy.devOutbox.description}
      </p>

      <div className="mt-5 flex flex-col gap-2.5">
        {rows.map((row) => {
          const link = row.html.match(/https?:\/\/[^"'<\s]+/)?.[0] ?? null;
          return (
            <div key={row.id} className="card p-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-[14px] font-medium text-ink">{row.to}</p>
                <span className="flex-none rounded-full border border-line px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                  {copy.devOutbox.kinds[row.kind]}
                </span>
              </div>
              <p className="mt-0.5 text-[13px] text-ink-muted">{row.subject}</p>
              {link ? (
                <a
                  href={link}
                  className="mt-2 block break-all text-[13px] font-medium text-accent underline decoration-accent/30 underline-offset-2"
                >
                  {link}
                </a>
              ) : null}
            </div>
          );
        })}
        {rows.length === 0 ? (
          <div className="card p-5 text-[14px] text-ink-muted">
            {copy.devOutbox.empty}
          </div>
        ) : null}
      </div>
    </main>
  );
}
