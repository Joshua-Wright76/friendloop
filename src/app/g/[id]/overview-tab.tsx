"use client";

import Link from "next/link";
import { nudgeAction, pauseAction, sendNowAction } from "./actions";
import { Cherries, Tape } from "@/components/stationery";
import { LoopNav } from "@/components/loop-nav";
import { copy, text } from "@/lib/copy";
import { useLoopData } from "./loop-data";

export default function OverviewTab({ welcome, nudged }: { welcome?: string; nudged?: string }) {
  const { group, membership, people, questions, openIssue, openProgress, openWaiting, nextRoundLabel, openIssueDeadlineLabel, weekdayLabel } = useLoopData();
  const manages = membership.access !== "member";
  const isOwner = membership.access === "owner";
  const nextLabel = nextRoundLabel;
  const progress = openProgress;
  const writers = people.filter((person) => person.participation === "contributor").length;
  const pool = questions.filter((question) => question.active);

  return (
    <main className="mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6">
      <header className="stitched flex items-center justify-between gap-3 border-b pb-4">
        <Link href="/you" className="flex min-w-0 items-center gap-2 font-display text-[23px] font-bold text-ink no-underline">
          <Cherries className="h-7 w-7 flex-none" /><span className="truncate">{group.name}</span>
        </Link>
        <span className="chip border bg-card px-2.5 py-1 text-[12px] font-bold capitalize text-ink-soft">{copy.common.roles[membership.access]}</span>
      </header>
      <LoopNav id={group.id} active="Overview" isOwner={isOwner} />

      {welcome === "1" ? (
        <div role="status" className="notice settle mb-5 border bg-accent-soft px-4 py-3 text-[14px] leading-relaxed">
          {copy.loop.welcome}
        </div>
      ) : null}

      {nudged ? (
        <div role="status" className="notice settle mb-5 border bg-accent-soft px-4 py-3 text-[14px] leading-relaxed">
          {nudged === "0"
            ? copy.loop.everyoneIn
            : nudged === "1"
              ? copy.loop.nudgedOne
              : text(copy.loop.nudged, { count: Number(nudged) })}
        </div>
      ) : null}

      <p className="eyebrow">{copy.loop.eyebrow}</p>
      <h1 className="mt-1 text-ink">{group.name}</h1>
      <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">
        {text(copy.loop.schedule, {
          cadence: group.cadenceWeeks === 1 ? copy.loop.cadenceWeek : text(copy.loop.cadenceWeeks, { count: group.cadenceWeeks }),
          weekday: weekdayLabel,
          hour: group.promptHour,
          timezone: group.timezone,
        })}
      </p>

      <div className="card ride-in mt-6 p-5 pt-7">
        <Tape tone="stripe" />
        <p className="eyebrow">
          {group.pausedAt ? copy.loop.paused : copy.loop.nextRound}
        </p>
        <h2 className="mt-2 text-ink">
          {group.pausedAt ? copy.loop.nothingScheduled : nextLabel.inLoopZone}
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
          {group.pausedAt
            ? copy.loop.pausedDescription
            : nextLabel.inViewerZone
              ? text(copy.loop.viewerTimezone, { time: nextLabel.inViewerZone })
              : copy.loop.opensForAnswers}
        </p>

        {manages ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <form action={sendNowAction}>
              <input type="hidden" name="groupId" value={group.id} />
              <button type="submit" className="btn btn-primary h-10 text-[14px]">
                {copy.loop.sendNow}
              </button>
            </form>
            <form action={pauseAction}>
              <input type="hidden" name="groupId" value={group.id} />
              <input type="hidden" name="paused" value={group.pausedAt ? "0" : "1"} />
              <button type="submit" className="btn btn-quiet h-10 text-[14px]">
                {group.pausedAt ? copy.loop.resume : copy.loop.pause}
              </button>
            </form>
          </div>
        ) : null}
      </div>

      {openIssue ? (
        <div className="card ride-in mt-5 p-5 pt-7">
          <Tape tone="dots" position="right" />
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[13px] font-medium text-ink-muted">{text(copy.loop.round, { number: openIssue.number })}</p>
            <p className="text-[13px] font-medium text-ink-soft numeric">
              {text(copy.loop.progress, { answered: progress.length, writers })}
            </p>
          </div>
          <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">
            {text(copy.loop.closes, { deadline: openIssueDeadlineLabel ?? "" })}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {progress.map((person) => (
              <span
                key={person.id}
                className="rounded-full bg-field px-2.5 py-1 text-[12px] font-medium text-ink-soft"
              >
                {person.name ?? person.email.split("@")[0]}
              </span>
            ))}
            {progress.length === 0 ? (
              <span className="text-[13px] text-ink-muted">{copy.loop.nobody}</span>
            ) : null}
          </div>

          {writers > 0 ? (
            openWaiting.length > 0 ? (
              <div className="mt-3">
                <p className="text-[12px] font-medium text-ink-muted">{copy.loop.waitingTitle}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {openWaiting.map((person) => (
                    <span
                      key={person.id}
                      className="rounded-full border border-line px-2.5 py-1 text-[12px] font-medium text-ink-soft"
                    >
                      {person.name ?? person.email.split("@")[0]}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-[13px] text-ink-muted">{copy.loop.everyoneIn}</p>
            )
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              href={`/g/${group.id}/issues`}
              className="text-[14px] font-medium text-accent hover:underline"
            >
              {copy.loop.seeRound}
            </Link>
            {manages && openWaiting.length > 0 ? (
              <form action={nudgeAction}>
                <input type="hidden" name="groupId" value={group.id} />
                <button type="submit" className="btn btn-quiet h-9 min-h-9 px-3 text-[13px]">
                  {copy.loop.nudge}
                </button>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-4">
        <Link href={`/g/${group.id}/members`} className="card loop-card px-4 py-4 no-underline">
          <span className="block font-display text-[23px] font-bold text-ink">{copy.common.navigation.people}</span>
          <span className="mt-1 block text-[13px] text-ink-muted numeric">{text(copy.loop.peopleCount, { count: people.length })}</span>
        </Link>
        <Link href={`/g/${group.id}/questions`} className="card loop-card px-4 py-4 no-underline">
          <span className="block font-display text-[23px] font-bold text-ink">{copy.common.navigation.questions}</span>
          <span className="mt-1 block text-[13px] text-ink-muted numeric">{text(copy.loop.questionsCount, { count: pool.length })}</span>
        </Link>
      </div>
    </main>
  );
}
