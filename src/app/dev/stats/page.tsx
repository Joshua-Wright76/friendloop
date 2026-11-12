import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ActivityChart } from "./activity-chart";
import { setBlockedAction } from "./actions";
import { copy, text } from "@/lib/copy";
import { formatMoment } from "@/lib/format";
import { getNow } from "@/lib/clock";
import { readStats } from "@/lib/stats";
import { changePercent, parseStatsRange, STATS_RANGES, type StatsRange } from "@/lib/stats-view";
import { requireUiPreview } from "@/lib/ui-preview";

export const instant = false;

export const metadata: Metadata = {
  title: copy.devStats.title,
  robots: { index: false, follow: false },
};

const numbers = new Intl.NumberFormat("en");

function MetricIcon({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}

const ICONS = {
  people: <MetricIcon><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.4-3.2 2.2-5 5.5-5s5.1 1.8 5.5 5M16 5.5a3 3 0 0 1 0 5.8M17 14c2.2.4 3.4 2.1 3.7 5" /></MetricIcon>,
  answers: <MetricIcon><path d="M5 4h14v12H9l-4 4V4Z" /><path d="M8 8h8M8 12h5" /></MetricIcon>,
  rounds: <MetricIcon><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M8 14h3" /></MetricIcon>,
  loops: <MetricIcon><path d="M8 12a4 4 0 0 1 0-8c5 0 5 16 8 16a4 4 0 0 0 0-8c-5 0-5 16-8 16a4 4 0 0 1 0-8" transform="translate(0 -4)" /></MetricIcon>,
};

function trend(current: number, previous: number): string {
  const c = copy.devStats.trends;
  if (previous === 0) return current === 0 ? c.none : c.new;
  const change = changePercent(current, previous) ?? 0;
  if (change === 0) return c.same;
  return text(change > 0 ? c.up : c.down, { value: Math.abs(change) });
}

function StatusMark({ ok }: { ok: boolean }) {
  return <span aria-hidden="true" className={`mt-1.5 h-2 w-2 flex-none rounded-full ${ok ? "bg-success" : "bg-danger"}`} />;
}

/** Product usage and operating health, with no individually identifiable records. */
export default async function DevStatsPage({ searchParams }: {
  searchParams: Promise<{ range?: string | string[]; outcome?: string; count?: string }>;
}) {
  await requireUiPreview();
  const c = copy.devStats;
  const [{ range: requestedRange, outcome, count }, at] = await Promise.all([searchParams, getNow()]);
  const range = parseStatsRange(requestedRange);
  const stats = await readStats(range, at);
  const usage = stats.usage;

  const notice =
    outcome === "blocked"
      ? text(c.blocked, { count: count ?? "0" })
      : outcome === "unblocked"
        ? c.unblocked
        : outcome === "notFound"
          ? c.notFound
          : null;

  const metrics = [
    { key: "people", label: c.metrics.activePeople, value: usage.activePeople, current: usage.activePeople, previous: usage.previousActivePeople, detail: text(c.metrics.activePeopleDetail, { count: stats.people }) },
    { key: "answers", label: c.metrics.answers, value: usage.answers, current: usage.answers, previous: usage.previousAnswers, detail: c.metrics.answersDetail },
    { key: "rounds", label: c.metrics.rounds, value: usage.rounds, current: usage.rounds, previous: usage.previousRounds, detail: text(c.metrics.roundsDetail, { count: stats.delivered }) },
    { key: "loops", label: c.metrics.loops, value: usage.loops, current: usage.loops, previous: usage.previousLoops, detail: text(c.metrics.loopsDetail, { count: stats.activeLoops }) },
  ] as const;
  const largestSize = Math.max(1, ...stats.loopSizes.map((row) => row.count));
  const budgetPercent = Math.min(100, Math.round((stats.sent / stats.budget) * 100));

  return (
    <main className="mx-auto w-full max-w-[1120px] px-4 pb-24 pt-7 sm:px-6 sm:pt-10">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-accent-ink">{c.eyebrow}</p>
          <h1 className="mt-1 text-ink">{c.title}</h1>
          <p className="mt-2 max-w-[620px] text-[14px] leading-relaxed text-ink-soft">{c.description}</p>
        </div>
        <p className="m-0 text-[12px] tabular-nums text-ink-muted">{text(c.updated, { when: formatMoment(at, "UTC") })}</p>
      </header>

      <div role="note" className="mt-5 flex items-start gap-3 rounded-xl border border-success/35 bg-success-soft px-4 py-3 text-[13px] leading-relaxed text-ink-soft">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="mt-0.5 h-5 w-5 flex-none text-success" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 4.5 6v5.5c0 4.5 3 7.8 7.5 9.5 4.5-1.7 7.5-5 7.5-9.5V6L12 3Z" /><path d="m9 12 2 2 4-4" /></svg>
        <div><strong className="block font-extrabold text-ink">{c.privacyTitle}</strong><span>{c.privacy}</span></div>
      </div>
      {notice ? <p role="status" className="notice mt-3 rounded-xl border border-line bg-card px-4 py-3 text-[14px] text-ink">{notice}</p> : null}

      <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-ink">{c.usageHeading}</h2>
        <nav aria-label={c.rangeLabel} className="inline-flex rounded-full border border-line-strong bg-card p-1 shadow-sm">
          {STATS_RANGES.map((days: StatsRange) => (
            <Link key={days} href={`/dev/stats?range=${days}`} aria-current={range === days ? "page" : undefined} className={`inline-flex min-h-9 items-center rounded-full px-3 text-[12px] font-extrabold no-underline transition-colors sm:px-4 ${range === days ? "bg-accent text-on-accent" : "text-ink-soft hover:bg-accent-soft hover:text-ink"}`}>
              {text(c.range, { count: days })}
            </Link>
          ))}
        </nav>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.key} className="card flex min-w-0 flex-col p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2 text-accent-ink">
              <dt className="text-[12px] font-bold leading-snug text-ink-soft sm:text-[13px]">{metric.label}</dt>
              <span className="hidden text-accent sm:block">{ICONS[metric.key]}</span>
            </div>
            <dd className="mt-3 text-[30px] font-semibold leading-none tracking-[-0.035em] tabular-nums text-ink sm:text-[36px]">{numbers.format(metric.value)}</dd>
            <dd className="mt-2 text-[11px] font-bold tabular-nums text-ink-soft sm:text-[12px]">{trend(metric.current, metric.previous)}</dd>
            <dd className="mt-auto pt-3 text-[11px] leading-snug text-ink-muted sm:text-[12px]">{metric.detail}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="activity-heading" className="card mt-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 id="activity-heading" className="m-0 text-ink">{c.activityHeading}</h2><p className="mt-1 text-[13px] text-ink-muted">{text(c.activityDescription, { count: range })}</p></div>
          <span className="rounded-full bg-accent-soft px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide text-accent-ink">{c.daily}</span>
        </div>
        <ActivityChart data={usage.daily} />
      </section>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section aria-labelledby="loop-sizes-heading" className="card p-5 sm:p-6">
          <h2 id="loop-sizes-heading" className="m-0 text-ink">{c.loopSizesHeading}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{c.loopSizesDescription}</p>
          <div className="mt-6 flex flex-col gap-4">
            {stats.loopSizes.map((row) => (
              <div key={row.key}>
                <div className="mb-1.5 flex items-center justify-between gap-3 text-[13px]"><span className="font-bold text-ink-soft">{c.loopSizes[row.key]}</span><span className="font-extrabold tabular-nums text-ink">{numbers.format(row.count)}</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-accent-soft" aria-hidden="true"><div className="h-full rounded-full bg-accent" style={{ width: `${(row.count / largestSize) * 100}%` }} /></div>
              </div>
            ))}
          </div>
          <p className="mb-0 mt-6 border-t border-dashed border-line pt-4 text-[12px] text-ink-muted">{text(c.loopSizesTotal, { active: stats.activeLoops, paused: stats.pausedLoops, added: usage.newLoops })}</p>
        </section>

        <section aria-labelledby="membership-heading" className="card p-5 sm:p-6">
          <h2 id="membership-heading" className="m-0 text-ink">{c.membershipHeading}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{c.membershipDescription}</p>
          <dl className="mt-5 grid grid-cols-2 gap-3">
            {([
              ["contributors", stats.members.contributors],
              ["readers", stats.members.readers],
              ["pending", stats.members.pending],
              ["muted", stats.members.muted],
            ] as const).map(([key, value]) => (
              <div key={key} className="rounded-lg border border-line bg-field px-4 py-3">
                <dt className="text-[12px] font-bold text-ink-soft">{c.members[key]}</dt>
                <dd className="mt-1 text-[25px] font-semibold tabular-nums text-ink">{numbers.format(value)}</dd>
              </div>
            ))}
          </dl>
          <p className="mb-0 mt-5 text-[12px] leading-relaxed text-ink-muted">{text(c.newPeople, { count: usage.newPeople, range })}</p>
        </section>
      </div>

      <section aria-labelledby="operations-heading" className="card mt-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 id="operations-heading" className="m-0 text-ink">{c.operationsHeading}</h2><p className="mt-1 text-[13px] text-ink-muted">{c.operationsDescription}</p></div>
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-extrabold ${stats.health.ok ? "bg-success-soft text-success" : "bg-danger/10 text-danger"}`}>
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${stats.health.ok ? "bg-success" : "bg-danger"}`} />{stats.health.ok ? c.healthy : c.attention}
          </span>
        </div>
        <div className="mt-5 grid gap-x-8 gap-y-5 md:grid-cols-2">
          <div className="flex items-start gap-3"><StatusMark ok={stats.health.checks.sweep.ok} /><div><h3 className="m-0 font-sans text-[14px] font-extrabold text-ink">{c.scheduler}</h3><p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{stats.lastSweepAt ? text(c.sweep, { when: formatMoment(stats.lastSweepAt, "UTC") }) : c.sweepNever}</p></div></div>
          <div className="flex items-start gap-3"><StatusMark ok={stats.health.checks.outbox.ok} /><div><h3 className="m-0 font-sans text-[14px] font-extrabold text-ink">{c.outbox}</h3><p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{text(c.outboxDetail, { waiting: stats.unsent, stuck: stats.health.checks.outbox.stuck, open: stats.open })}</p></div></div>
          <div>
            <div className="flex items-center justify-between gap-3"><h3 className="m-0 font-sans text-[14px] font-extrabold text-ink">{c.emailBudget}</h3><span className="text-[12px] font-bold tabular-nums text-ink-soft">{text(c.sent, { sent: stats.sent, budget: stats.budget })}</span></div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-accent-soft" role="progressbar" aria-label={c.emailBudget} aria-valuemin={0} aria-valuemax={stats.budget} aria-valuenow={stats.sent}><div className="h-full rounded-full bg-accent" style={{ width: `${budgetPercent}%` }} /></div>
            <p className="mt-1.5 text-[12px] text-ink-muted">{c.emailBudgetDetail}</p>
          </div>
          <div><h3 className="m-0 font-sans text-[14px] font-extrabold text-ink">{c.deliverability}</h3><p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{text(c.deliverabilityDetail, { bounced: stats.bounced, complaints: stats.complaints })}</p><p className="mt-2 text-[13px]"><Link className="link" href="/dev/feedback">{text(c.feedbackLink, { count: stats.feedback })}</Link></p></div>
        </div>
      </section>

      <details className="card mt-4 overflow-hidden">
        <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-4 px-5 py-4 font-extrabold text-ink sm:px-6"><span>{c.blockHeading}</span><span className="text-[12px] font-bold text-ink-muted">{c.accountControls}</span></summary>
        <div className="border-t border-line px-5 py-5 sm:px-6">
          <p className="mt-0 max-w-[760px] text-[13px] leading-relaxed text-ink-soft">{c.blockBody}</p>
          <form action={setBlockedAction} className="mt-4 flex flex-col gap-3">
            <label htmlFor="block-email" className="text-[13px] font-bold text-ink-soft">{c.blockLabel}</label>
            <input id="block-email" name="email" type="email" required autoComplete="off" className="field min-h-11 max-w-[440px]" />
            <div className="flex flex-wrap gap-2"><button type="submit" name="intent" value="block" className="btn btn-primary h-11 min-h-11 px-4 text-[13px]">{c.block}</button><button type="submit" name="intent" value="unblock" className="btn btn-quiet h-11 min-h-11 px-4 text-[13px]">{c.unblock}</button></div>
          </form>
        </div>
      </details>
    </main>
  );
}
