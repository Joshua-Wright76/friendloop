"use client";

import { SafeForm } from "@/components/safe-form";
import Link from "next/link";
import { nudgeAction, pauseAction, sendNowAction } from "./actions";
import { Avatar } from "@/components/avatar";
import { ConfirmAction } from "@/components/confirm-action";
import { Tape } from "@/components/stationery";
import { LoopNav } from "@/components/loop-nav";
import { NoticeFocus } from "@/components/notice-focus";
import { copy, text } from "@/lib/copy";
import { atMoment, formatHour, listNames, timezonePlace } from "@/lib/format";
import { issueTitle } from "@/lib/issue-name";
import { useLoopData } from "./loop-data";
import { SubmitButton } from "@/components/submit-button";

export default function OverviewTab({ welcome, nudged }: { welcome?: string; nudged?: string }) {
  const { group, membership, people, questions, rounds, openIssue, openProgress, openWaiting, nextMoment, openMoment, weekdayLabel, lastNudge, nextWhenThisCloses } = useLoopData();
  const manages = membership.access !== "member";
  const writers = people.filter((person) => person.participation === "contributor").length;
  const pool = questions.filter((question) => question.active);
  const firstRun = manages && people.length <= 1 && rounds.length === 0;
  const display = (person: { name: string | null; email: string }) => person.name ?? person.email.split("@")[0];
  const inPeople = openProgress.map((person) => people.find((candidate) => candidate.id === person.id) ?? { ...person, photoUrl: null });
  const waitingNames = listNames(openWaiting.map(display));

  return (
    <main className="mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6">
      <LoopNav id={group.id} name={group.name} access={membership.access} active="Overview" nameIsHeading snapshotUrl={group.headerImageUrl} />

      {welcome === "1" || welcome === "no-picture" ? (
        <NoticeFocus spacing="mt-4">
          {people.length > 1 ? copy.loop.welcomeInvited : copy.loop.welcome}
          {welcome === "no-picture" ? ` ${copy.loop.welcomeNoPicture}` : ""}
        </NoticeFocus>
      ) : null}

      {nudged ? (
        <NoticeFocus spacing="mt-4">
          {nudged === "0"
            ? copy.loop.everyoneIn
            : nudged === "1"
              ? copy.loop.nudgedOne
              : text(copy.loop.nudged, { count: Number(nudged) })}
        </NoticeFocus>
      ) : null}

      {firstRun ? (
        <section className="card ride-in mt-5 p-5 pt-7">
          <Tape tone="dots" position="left" />
          <h2 className="text-ink">{copy.loop.firstRunTitle}</h2>
          <p className="mt-1.5 max-w-[56ch] text-[15px] leading-relaxed text-ink-soft">{copy.loop.firstRunBody}</p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <Link href={`/g/${group.id}/members#invite-people`} className="btn btn-primary">{copy.loop.firstRunInvite}</Link>
            <Link href={`/g/${group.id}/questions`} className="btn btn-quiet">{copy.loop.firstRunQuestions}</Link>
          </div>
        </section>
      ) : null}

      {openIssue ? (
        <section className="card ride-in mt-5 p-5 pt-7" aria-labelledby="this-round">
          <Tape tone="dots" position="left" />
          <p className="text-[14px] font-extrabold text-ink-soft">{issueTitle(copy.loop.round, openIssue.number, openIssue.name)}</p>
          <h2 id="this-round" className="mt-0.5 text-ink numeric">
            {text(copy.loop.progress, { answered: openProgress.length, writers })}
          </h2>
          <p className="mt-1 text-[15px] leading-relaxed text-ink-soft numeric">
            {text(copy.loop.closes, { deadline: atMoment(openMoment?.primary ?? "") })}
            {openMoment?.loop ? <span className="text-ink-muted"> ({openMoment.loop})</span> : null}
          </p>

          <div className="round-people mt-4">
            <div>
              <p className="round-people__label">{copy.loop.inTitle}</p>
              {inPeople.length > 0 ? (
                <ul className="round-people__list">
                  {inPeople.map((person) => (
                    <li key={person.id} className="person-pill person-pill--in">
                      <Avatar name={display(person)} photoUrl={person.photoUrl} className="album-avatar" />
                      {display(person)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[14px] text-ink-muted">{copy.loop.nobody}</p>
              )}
            </div>
            <div>
              <p className="round-people__label">{copy.loop.waitingTitle}</p>
              {openWaiting.length > 0 ? (
                <ul className="round-people__list">
                  {openWaiting.map((person) => (
                    <li key={person.id} className="person-pill">
                      <Avatar name={display(person)} photoUrl={person.photoUrl} className="album-avatar" />
                      {display(person)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[14px] text-ink-muted">{copy.loop.everyoneIn}</p>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-start gap-x-4 gap-y-2">
            {manages && openWaiting.length > 0 ? (
              <>
                <ConfirmAction
                  className="w-full sm:w-auto"
                  action={nudgeAction}
                  fields={{ groupId: group.id }}
                  label={lastNudge ? copy.loop.nudgeAgain : text(copy.loop.nudgeNamed, { names: waitingNames })}
                  triggerLabel={lastNudge ? text(copy.loop.nudgeAgainLabel, { names: waitingNames }) : text(copy.loop.nudgeNamed, { names: waitingNames })}
                  tone="primary"
                  triggerTone={lastNudge ? "quiet" : "primary"}
                  question={text(copy.loop.nudgeQuestion, { names: waitingNames })}
                  body={openWaiting.length === 1 ? copy.loop.nudgeBodyOne : copy.loop.nudgeBody}
                  confirmLabel={copy.loop.nudgeConfirm}
                  cancelLabel={copy.a11yLabels.confirmCancel}
                />
                {lastNudge ? (
                  <p className="done-note numeric" role="status">
                    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 flex-none"><path d="m4 10 4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    {text(copy.loop.nudgedAt, { when: lastNudge })}
                  </p>
                ) : null}
              </>
            ) : null}
            <Link href={`/g/${group.id}/issues`} className="link">{copy.loop.seeRound}</Link>
          </div>
        </section>
      ) : null}

      <section className="card ride-in mt-5 p-5 pt-6" aria-labelledby="next-round">
        <Tape tone="stripe" />
        <h2 id="next-round" className="text-ink">
          {group.pausedAt ? copy.loop.paused : copy.loop.nextRoundTitle}
        </h2>
        {group.pausedAt ? null : <p className="m-0 mt-1 text-[16px] font-extrabold leading-snug text-ink numeric first-letter:uppercase">{nextMoment.primary}</p>}
        <p className="m-0 mt-1 text-[15px] leading-relaxed text-ink-soft">
          {group.pausedAt ? copy.loop.pausedDescription : nextWhenThisCloses ? copy.loop.nextAsThisCloses : nextMoment.loop ?? copy.loop.opensForAnswers}
        </p>

        {manages ? (
          <div className="mt-3.5 flex flex-wrap items-start gap-2.5">
            <SafeForm action={pauseAction}>
              <input type="hidden" name="groupId" value={group.id} />
              <input type="hidden" name="paused" value={group.pausedAt ? "0" : "1"} />
              <SubmitButton className={group.pausedAt ? "btn btn-primary" : "btn btn-quiet"}>
                {group.pausedAt ? copy.loop.resume : copy.loop.pause}
              </SubmitButton>
            </SafeForm>
            {/* One round at a time: while one is open, "Send now" would only return it, so it isn't offered. */}
            {openIssue ? null : (
              <ConfirmAction
                className="w-full sm:w-auto"
                action={sendNowAction}
                fields={{ groupId: group.id }}
                label={copy.loop.sendNow}
                triggerLabel={copy.loop.sendNow}
                tone="primary"
                triggerTone="quiet"
                question={copy.loop.sendNowQuestion}
                body={people.length <= 1 ? copy.loop.sendNowBodyAlone : copy.loop.sendNowBody}
                confirmLabel={copy.loop.sendNowConfirm}
                cancelLabel={copy.a11yLabels.confirmCancel}
              />
            )}
          </div>
        ) : null}

        <p className="mt-4 border-t border-dashed border-line pt-3 text-[14px] leading-relaxed text-ink-soft numeric">
          {text(copy.loop.schedule, {
            cadence: group.cadenceWeeks === 1 ? copy.loop.cadenceWeek : text(copy.loop.cadenceWeeks, { count: group.cadenceWeeks }),
            weekday: weekdayLabel,
            hour: formatHour(group.promptHour),
            timezone: timezonePlace(group.timezone),
          })}{" "}
          <Link href={`/g/${group.id}/members`} className="link link--inline">{text(copy.loop.peopleCount, { count: people.length })}</Link>
          {" · "}
          <Link href={`/g/${group.id}/questions`} className="link link--inline">{text(copy.loop.questionsCount, { count: pool.length })}</Link>
        </p>
      </section>
    </main>
  );
}
