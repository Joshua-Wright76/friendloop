"use client";

import { SafeForm } from "@/components/safe-form";
import Link from "next/link";
import Form from "next/form";
import { LoopNav } from "@/components/loop-nav";
import { AutoPicker } from "@/components/auto-picker";
import { CopyLink } from "@/components/copy-link";
import { NoticeFocus } from "@/components/notice-focus";
import { formatDate, listNames } from "@/lib/format";
import { copy, text } from "@/lib/copy";
import { issueTitle } from "@/lib/issue-name";
import { coverOf } from "@/lib/looks";
import { ZineCover } from "@/components/round-cover";
import { RoundNameFields } from "./round-name-fields";
import { renameIssueAction } from "./actions";
import { useLoopData } from "../loop-data";
import { SubmitButton } from "@/components/submit-button";
import { DisplayDigits } from "@/components/display-digits";

export default function IssuesTab({
  notices,
  filter,
}: {
  notices: { sent?: string; next?: string; nothingToSend?: string; named?: string };
  filter: { memberId: string; roundIds: string[] } | null;
}) {
  const { group, membership, rounds: allRounds, openIssue, people, openProgress, openWaiting } = useLoopData();
  // A paused loop holds its round, but nobody can answer it.
  const open = group.pausedAt ? null : openIssue;
  const display = (person: { name: string | null; email: string }) => person.name ?? person.email.split("@")[0];
  const id = group.id;
  const manages = membership.access !== "member";

  // Reading one person across the year: only delivered rounds they answered in.
  const contributors = people
    .filter((person) => person.participation === "contributor")
    .map((person) => ({ id: person.id, name: person.name ?? person.email.split("@")[0] }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const focus = filter ? contributors.find((person) => person.id === filter.memberId) ?? null : null;
  const answered = new Set(filter?.roundIds ?? []);
  const rounds = focus ? allRounds.filter((round) => answered.has(round.id)) : allRounds;

  return (
    <main className="loop-page mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6 lg:max-w-[1040px]">
      <LoopNav id={id} name={group.name} access={membership.access} active="Rounds">
        <h1>{copy.rounds.title}</h1>
        <p>
          {open
            ? open.name
              ? text(copy.rounds.openNamed, { name: open.name })
              : text(copy.rounds.open, { number: open.number })
            : copy.rounds.nothingOpen}
        </p>
      {contributors.length > 1 && allRounds.some((round) => round.status === "delivered") ? (
          <details className="filter-fold mt-1 border-t border-dashed border-line" open={focus ? true : undefined}>
          <summary><span className="link">{copy.rounds.filter.summary}</span>{focus ? <span className="font-bold">{focus.name}</span> : null}</summary>
          {/* A client navigation, not a document load; without script it is a plain GET. */}
          <Form action={`/g/${id}/issues`} className="pb-1">
            <div className="filter-line">
              <span className="text-[14px] font-bold text-ink-soft">{copy.rounds.filter.label}</span>
              <AutoPicker
                name="member"
                defaultValue={focus?.id ?? ""}
                ariaLabel={copy.rounds.filter.label}
                options={[{ value: "", label: copy.rounds.filter.everyone }, ...contributors.map((person) => ({ value: person.id, label: person.name }))]}
              />
            </div>
            {focus ? (
              <p role="status" className="m-0 mt-2 text-[14px] leading-relaxed text-ink-soft">
                {text(copy.rounds.filter.showing, { name: focus.name })}{" "}
                {open ? copy.rounds.filter.openHidden : null}{" "}
                <Link href={`/g/${id}/issues`} className="link link--inline">{copy.rounds.filter.clear}</Link>
              </p>
            ) : null}
          </Form>
        </details>
        ) : null}
      </LoopNav>

      {notices.sent ? <NoticeFocus>{text(copy.rounds.sentNotice, { number: notices.sent, next: notices.next ?? Number(notices.sent) + 1 })}</NoticeFocus> : null}
      {notices.nothingToSend ? <NoticeFocus>{text(copy.rounds.nothingToSendNotice, { number: notices.nothingToSend })}</NoticeFocus> : null}
      {notices.named === "1" ? <NoticeFocus>{copy.rounds.nameSaved}</NoticeFocus> : null}
      {notices.named === "cover" ? <NoticeFocus>{copy.rounds.coverSaved}</NoticeFocus> : null}
      {notices.named === "0" ? <NoticeFocus>{copy.rounds.nameCleared}</NoticeFocus> : null}

      {rounds.length > 0 ? <ul className="mt-4 flex flex-col gap-3">
        {rounds.map((round) => {
          // A covered round is a little zine beside its card's words; a plain one looks as it always has.
          const cover = coverOf(round);
          const body = (
            <>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-ink"><DisplayDigits>{issueTitle(copy.rounds.round, round.number, round.name)}</DisplayDigits></h2>
              <span className={`chip flex-none border px-2.5 py-1 text-[13px] font-bold ${round.status === "open" ? "bg-accent-soft text-accent-ink" : "bg-card text-ink-soft"}`}>
                {round.status === "open" && group.pausedAt ? copy.loop.paused : copy.common.issueStatus[round.status]}
              </span>
            </div>
            <p className="mt-1 text-[14px] text-ink-soft numeric">
              {round.answers === 1 ? copy.rounds.answer : text(copy.rounds.answers, { count: round.answers })}
              {round.status !== "open" ? ` · ${formatDate(round.deliveredAt ?? round.deliversAt, group.timezone)}` : null}
              {round.status === "open" && !group.pausedAt ? ` · ${text(copy.rounds.goesOut, { date: formatDate(round.deliversAt, group.timezone) })}` : null}
            </p>
            {round.status === "open" ? (
              <div className="mt-2 text-[14px] leading-relaxed text-ink-soft">
                {openProgress.length > 0 ? <p className="m-0">{text(copy.rounds.answeredBy, { names: listNames(openProgress.map(display)) })}</p> : null}
                {openWaiting.length > 0 ? <p className="m-0">{text(copy.rounds.waitingOn, { names: listNames(openWaiting.map(display)) })}</p> : null}
              </div>
            ) : null}

            <div className="mt-1 flex flex-wrap items-center gap-x-5">
              {round.status !== "open" ? (
                <Link
                  href={focus ? `/i/${round.id}?by=${focus.id}` : `/i/${round.id}`}
                  aria-label={text(copy.a11yLabels.readRound, { title: issueTitle(copy.rounds.round, round.number, round.name) })}
                  className="link"
                >
                  {copy.rounds.read}
                </Link>
              ) : membership.access !== "member" ? (
                <Link
                  href={`/i/${round.id}`}
                  prefetch={false}
                  aria-label={text(copy.a11yLabels.previewRound, { title: issueTitle(copy.rounds.round, round.number, round.name) })}
                  className="link"
                >
                  {copy.rounds.preview}
                </Link>
              ) : null}

            {manages ? (
              <details className="round-rename">
                <summary aria-label={text(round.name ? copy.a11yLabels.renameNamedRound : copy.a11yLabels.renameRound, { title: issueTitle(copy.rounds.round, round.number, round.name) })} className="link link--quiet cursor-pointer">
                  {round.name ? copy.rounds.renameNamed : copy.rounds.rename}
                </summary>
                <SafeForm action={renameIssueAction} className="mt-1 flex flex-col gap-2">
                  <input type="hidden" name="groupId" value={id} />
                  <input type="hidden" name="issueId" value={round.id} />
                  <RoundNameFields number={round.number} loopName={group.name} name={round.name} coverSticker={round.coverSticker} coverTint={round.coverTint} />
                  <SubmitButton className="btn btn-quiet h-11 min-h-11 self-start text-[14px]">{copy.rounds.nameSave}</SubmitButton>
                </SafeForm>
              </details>
            ) : null}
            </div>

            {round.shareUrl ? (
              <p className="m-0 mt-2.5 text-[13px] font-bold text-ink-soft">{copy.rounds.shareLinkLabel}</p>
            ) : null}
            {round.shareUrl ? (
              <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-dashed border-line-strong bg-field px-3 py-1.5">
                <span className="min-w-0 wrap-any text-[13px] text-ink-soft">
                  {round.shareUrl.replace(/^https?:\/\//, "")}
                </span>
                <CopyLink url={round.shareUrl} />
              </div>
            ) : null}
            </>
          );
          return cover ? (
            <li key={round.id} className="card round-card--covered p-4 sm:p-5">
              <ZineCover cover={cover} name={round.name ?? ""} number={text(copy.rounds.cover.zine, { number: round.number })} />
              <div className="min-w-0">{body}</div>
            </li>
          ) : (
            <li key={round.id} className="card p-4 sm:p-5">{body}</li>
          );
        })}
      </ul> : null}
      {rounds.length === 0 && focus ? (
        <div className="card mt-5 p-5 text-[14px] text-ink-muted">
          <p>{text(copy.rounds.filter.empty, { name: focus.name })}</p>
        </div>
      ) : null}
      {rounds.length === 0 && !focus ? (
        <div className="card mt-5 p-5 text-[14px] text-ink-muted">
          <p>{copy.rounds.empty}</p>
          {membership.access !== "member" ? <Link href={`/g/${id}`} className="btn btn-primary mt-4 inline-flex">{copy.rounds.firstRoundAction}</Link> : null}
        </div>
      ) : null}
    </main>
  );
}
