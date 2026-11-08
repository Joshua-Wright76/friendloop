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
  const { group, membership, people, questionsPage, rounds, suggestions, openIssue, openProgress, openWaiting, nextMoment, openMoment, weekdayLabel, lastNudge, answerHref } = useLoopData();
  const manages = membership.access !== "member";
  const writers = people.filter((person) => person.participation === "contributor").length;
  // Everything still asked: turn-takers, every-round items, and dates still to come.
  const asked = questionsPage.queue.length + questionsPage.everyRound.length + questionsPage.dated.filter((item) => item.nextDate).length;
  const firstRun = manages && people.length <= 1 && !rounds.some((round) => round.status === "delivered");
  // A paused loop holds its round: nobody can answer it, so it isn't shown as open.
  const liveIssue = group.pausedAt ? null : openIssue;
  const display = (person: { name: string | null; email: string }) => person.name ?? person.email.split("@")[0];
  const inPeople = openProgress.map((person) => people.find((candidate) => candidate.id === person.id) ?? { ...person, photoUrl: null, avatarFrame: null });
  // Nobody nudges themselves: the person looking is left out of the reminder.
  const nudgeable = openWaiting.filter((person) => person.id !== membership.id);
  const waitingNames = listNames(nudgeable.map(display));
  // Counted the same way as the "In" list, so the button and the list always agree.
  const viewerIsIn = openProgress.some((person) => person.id === membership.id);
  // Answering your own round comes first; while it's undone, it is the one primary button.
  const answerFirst = Boolean(answerHref) && !viewerIsIn;

  return (
    <main className="loop-page mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6 lg:max-w-[1040px]">
      <LoopNav id={group.id} name={group.name} access={membership.access} active="Overview" nameIsHeading snapshotUrl={group.headerImageUrl} />

      {welcome === "1" || welcome === "no-picture" ? (
        <NoticeFocus spacing="mt-4">
          {people.length > 1 ? copy.loop.welcomeInvited : copy.loop.welcome}
          {welcome === "no-picture" ? ` ${copy.loop.welcomeNoPicture}` : ""}
        </NoticeFocus>
      ) : null}

      {nudged ? (
        <NoticeFocus spacing="mt-4">
          {nudged === "limited"
            ? copy.loop.nudgeLimited
            : nudged === "0"
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

      <div className="overview-grid">
      <div className="overview-grid__main">
      {liveIssue ? (
        <section className="card ride-in mt-5 p-5 pt-7" aria-labelledby="this-round">
          <Tape tone="dots" position="left" />
          <p className="text-[14px] font-extrabold text-ink-soft">{issueTitle(copy.loop.round, liveIssue.number, liveIssue.name)}</p>
          <h2 id="this-round" className="status-count mt-0.5 text-ink numeric">
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
                      <Avatar name={display(person)} photoUrl={person.photoUrl} frame={person.avatarFrame} className="album-avatar" />
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
                      <Avatar name={display(person)} photoUrl={person.photoUrl} frame={person.avatarFrame} className="album-avatar" />
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
            {answerFirst ? (
              <Link href={answerHref!} prefetch={false} className="btn btn-primary">
                {text(copy.loop.answerRound, { number: liveIssue.number })}
              </Link>
            ) : null}
            {/* "Send now" sends this round as it stands, so it needs something in it. */}
            {manages && openProgress.length > 0 ? (
              <ConfirmAction
                className="w-full sm:w-auto"
                action={sendNowAction}
                fields={{ groupId: group.id }}
                label={copy.loop.sendNow}
                triggerLabel={copy.loop.sendNow}
                tone="primary"
                triggerTone={answerFirst || nudgeable.length > 0 ? "quiet" : "primary"}
                question={text(copy.loop.sendNowQuestion, { number: liveIssue.number })}
                body={text(openProgress.length === 1 ? copy.loop.sendNowBodyOne : copy.loop.sendNowBody, {
                  count: openProgress.length,
                  next: liveIssue.number + 1,
                  when: atMoment(nextMoment.primary),
                })}
                confirmLabel={copy.loop.sendNowConfirm}
                cancelLabel={copy.a11yLabels.confirmCancel}
              />
            ) : null}
            {manages && nudgeable.length > 0 ? (
              <>
                <ConfirmAction
                  className="w-full sm:w-auto"
                  action={nudgeAction}
                  fields={{ groupId: group.id }}
                  label={lastNudge ? copy.loop.nudgeAgain : text(copy.loop.nudgeNamed, { names: waitingNames })}
                  triggerLabel={lastNudge ? text(copy.loop.nudgeAgainLabel, { names: waitingNames }) : text(copy.loop.nudgeNamed, { names: waitingNames })}
                  tone="primary"
                  triggerTone={answerFirst || lastNudge ? "quiet" : "primary"}
                  question={text(copy.loop.nudgeQuestion, { names: waitingNames })}
                  body={nudgeable.length === 1 ? copy.loop.nudgeBodyOne : copy.loop.nudgeBody}
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
            {/* Already in: editing is there, but the owner's own jobs come first. */}
            {answerHref && viewerIsIn ? (
              <Link href={answerHref} prefetch={false} className="btn btn-quiet">{copy.loop.editAnswers}</Link>
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
        <p className="m-0 mt-1 text-[16px] font-extrabold leading-snug text-ink numeric">
          {text(copy.loop.schedule, {
            cadence: group.cadenceWeeks === 1 ? copy.loop.cadenceWeek : text(copy.loop.cadenceWeeks, { count: group.cadenceWeeks }),
            weekday: weekdayLabel,
            hour: formatHour(group.promptHour),
            timezone: timezonePlace(group.timezone),
          })}
        </p>
        <p className="m-0 mt-1 text-[15px] leading-relaxed text-ink-soft">
          {group.pausedAt ? copy.loop.pausedDescription : copy.loop.nextAsThisCloses}
        </p>
        {manages && liveIssue && openProgress.length === 0 ? (
          <p className="m-0 mt-2 text-[13px] leading-relaxed text-ink-muted">{copy.loop.sendNowHint}</p>
        ) : null}

        {manages ? (
          <div className="mt-3.5 flex flex-wrap items-start gap-2.5">
            <SafeForm action={pauseAction}>
              <input type="hidden" name="groupId" value={group.id} />
              <input type="hidden" name="paused" value={group.pausedAt ? "0" : "1"} />
              <SubmitButton className={group.pausedAt ? "btn btn-primary" : "btn btn-quiet"}>
                {group.pausedAt ? copy.loop.resume : copy.loop.pause}
              </SubmitButton>
            </SafeForm>
          </div>
        ) : null}

        <p className="mt-4 border-t border-dashed border-line pt-3 text-[14px] leading-relaxed text-ink-soft numeric">
          <Link href={`/g/${group.id}/members`} className="link link--inline">{text(copy.loop.peopleCount, { count: people.length })}</Link>
          {" · "}
          <Link href={`/g/${group.id}/questions`} className="link link--inline">{text(copy.loop.questionsCount, { count: asked })}</Link>
        </p>
      </section>
      </div>
      <div className="overview-grid__side">
      {manages && suggestions.length > 0 ? (
        <section className="card needs-card ride-in mt-5 p-5 pt-6" aria-labelledby="needs-you">
          <h2 id="needs-you" className="text-ink">{copy.loop.needsTitle}</h2>
          <Link href={`/g/${group.id}/questions#suggestions`} className="yours-link mt-1">
            <span className="yours-link__title numeric">
              {suggestions.length === 1 ? copy.loop.yoursSuggestionsOne : text(copy.loop.yoursSuggestions, { count: suggestions.length })}
            </span>
            <span className="yours-link__hint">{copy.loop.yoursSuggestionsHint}</span>
          </Link>
        </section>
      ) : null}
      <section className="card ride-in mt-5 p-5 pt-6" aria-labelledby="make-it-yours">
        <h2 id="make-it-yours" className="text-ink">{copy.loop.yoursTitle}</h2>
        <ul className="yours-list mt-2">
          {manages ? (
            <li>
              <Link href={`/g/${group.id}/settings?stationery=open`} className="yours-link">
                <span className="yours-link__title">{copy.loop.yoursStationery}</span>
                <span className="yours-link__hint">{copy.loop.yoursStationeryHint}</span>
              </Link>
            </li>
          ) : null}
          <li>
            <Link href={`/g/${group.id}/members?look=open#your-look`} className="yours-link">
              <span className="yours-link__title">{copy.loop.yoursCharm}</span>
              <span className="yours-link__hint">{copy.loop.yoursCharmHint}</span>
            </Link>
          </li>
        </ul>
      </section>
      </div>
      </div>
    </main>
  );
}
