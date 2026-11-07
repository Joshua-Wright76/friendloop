import Link from "next/link";
import type { Metadata } from "next";
import { copy, text } from "@/lib/copy";
import { formatMoment } from "@/lib/format";
import { readStats } from "@/lib/stats";
import { requireUiPreview } from "@/lib/ui-preview";
import { setBlockedAction } from "./actions";

export const instant = false;

export const metadata: Metadata = {
  title: copy.devStats.title,
  robots: { index: false, follow: false },
};

/** How the beta is going, and the one lever for stopping an account. */
export default async function DevStatsPage({ searchParams }: {
  searchParams: Promise<{ outcome?: string; email?: string; count?: string }>;
}) {
  await requireUiPreview();
  const c = copy.devStats;
  const [{ outcome, email, count }, stats] = await Promise.all([searchParams, readStats()]);

  const totals: [string, number][] = [
    [c.totals.people, stats.people],
    [c.totals.activeLoops, stats.activeLoops],
    [c.totals.pausedLoops, stats.pausedLoops],
    [c.totals.delivered, stats.delivered],
    [c.totals.open, stats.open],
    [c.totals.unsent, stats.unsent],
    [c.totals.bounced, stats.bounced],
    [c.totals.complaints, stats.complaints],
    [c.totals.feedback, stats.feedback],
  ];
  const notice =
    outcome === "blocked"
      ? text(c.blocked, { email: email ?? "", count: count ?? "0" })
      : outcome === "unblocked"
        ? text(c.unblocked, { email: email ?? "" })
        : outcome === "notFound"
          ? text(c.notFound, { email: email ?? "" })
          : null;

  return (
    <main className="mx-auto w-full max-w-[760px] px-4 pb-24 pt-5">
      <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.025em] text-ink">{c.title}</h1>
      <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">{c.description}</p>
      <p role="note" className="notice mt-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-[13px] leading-relaxed text-danger">
        {c.warning}
      </p>
      {notice ? <p role="status" className="notice mt-3 rounded-xl border border-line px-4 py-3 text-[14px] text-ink">{notice}</p> : null}

      <dl className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {totals.map(([label, value]) => (
          <div key={label} className="card p-4">
            <dt className="text-[13px] text-ink-soft">{label}</dt>
            <dd className="mt-1 text-[24px] font-semibold text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 text-[14px] text-ink-soft">{text(c.sent, { sent: stats.sent, budget: stats.budget })}</p>
      <p className="mt-1 text-[14px] text-ink-soft">
        {stats.lastSweepAt ? text(c.sweep, { when: formatMoment(stats.lastSweepAt, "UTC") }) : c.sweepNever}
      </p>
      <p className="mt-1 text-[14px]"><Link className="link" href="/dev/feedback">{c.feedbackLink}</Link></p>

      <h2 className="mt-8 text-[18px] font-semibold text-ink">{c.loopsHeading}</h2>
      {stats.loops.length === 0 ? (
        <p className="mt-2 text-[14px] text-ink-soft">{c.empty}</p>
      ) : (
        <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label={c.loopsHeading}>
          <table className="w-full text-left text-[14px] text-ink">
            <thead className="text-[13px] text-ink-soft">
              <tr>
                <th scope="col" className="py-2 pr-3 font-semibold">{c.loopColumns.name}</th>
                <th scope="col" className="py-2 pr-3 font-semibold">{c.loopColumns.owner}</th>
                <th scope="col" className="py-2 pr-3 font-semibold">{c.loopColumns.people}</th>
                <th scope="col" className="py-2 pr-3 font-semibold">{c.loopColumns.rounds}</th>
                <th scope="col" className="py-2 pr-3 font-semibold">{c.loopColumns.latest}</th>
                <th scope="col" className="py-2 font-semibold">{c.loopColumns.state}</th>
              </tr>
            </thead>
            <tbody>
              {stats.loops.map((loop) => (
                <tr key={loop.id} className="border-t border-dashed border-line">
                  <td className="py-2 pr-3 wrap-any">{loop.name}</td>
                  <td className="py-2 pr-3 wrap-any">{loop.owner ?? ""}</td>
                  <td className="py-2 pr-3">{loop.people}</td>
                  <td className="py-2 pr-3">{loop.rounds}</td>
                  <td className="py-2 pr-3">
                    {loop.latestAnswered == null ? c.noLatest : text(c.latest, { answered: loop.latestAnswered, writers: loop.latestWriters ?? 0 })}
                  </td>
                  <td className="py-2">{loop.paused ? c.paused : c.running}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-8 text-[18px] font-semibold text-ink">{c.blockHeading}</h2>
      <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{c.blockBody}</p>
      <form action={setBlockedAction} className="mt-3 flex flex-col gap-2">
        <label htmlFor="block-email" className="text-[14px] font-bold text-ink-soft">{c.blockLabel}</label>
        <input id="block-email" name="email" type="email" required autoComplete="off" className="field min-h-11" />
        <div className="flex flex-wrap gap-2">
          <button type="submit" name="intent" value="block" className="btn btn-primary h-11 min-h-11 px-4 text-[13px]">{c.block}</button>
          <button type="submit" name="intent" value="unblock" className="btn btn-quiet h-11 min-h-11 px-4 text-[13px]">{c.unblock}</button>
        </div>
      </form>

      {stats.blocked.length > 0 ? (
        <>
          <h3 className="mt-5 text-[15px] font-semibold text-ink">{c.blockedHeading}</h3>
          <ul className="mt-1 text-[14px] text-ink-soft">
            {stats.blocked.map((address) => <li key={address} className="wrap-any">{address}</li>)}
          </ul>
        </>
      ) : null}
    </main>
  );
}
