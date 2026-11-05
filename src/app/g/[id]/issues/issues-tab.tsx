"use client";

import { SafeForm } from "@/components/safe-form";
import Link from "next/link";
import { LoopNav } from "@/components/loop-nav";
import { AutoPicker } from "@/components/auto-picker";
import { CopyLink } from "@/components/copy-link";
import { NoticeFocus } from "@/components/notice-focus";
import { formatDate, listNames } from "@/lib/format";
import { copy, text } from "@/lib/copy";
import { issueTitle, MAX_ISSUE_NAME } from "@/lib/issue-name";
import { renameIssueAction } from "./actions";
import { useLoopData } from "../loop-data";
import { SubmitButton } from "@/components/submit-button";

export default function IssuesTab({
  notices,
  filter,
}: {
  notices: { opened?: string; alreadyOpen?: string; named?: string };
  filter: { memberId: string; roundIds: string[] } | null;
}) {
  const { group, membership, rounds: allRounds, openIssue: open, people, openProgress, openWaiting } = useLoopData();
  const display = (person: { name: string | null; email: string }) => person.name ?? person.email.split("@")[0];
  const id = group.id;
  const isOwner = membership.access === "owner";

  // Reading one person across the year: only delivered rounds they answered in.
  const contributors = people
    .filter((person) => person.participation === "contributor")
    .map((person) => ({ id: person.id, name: person.name ?? person.email.split("@")[0] }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const focus = filter ? contributors.find((person) => person.id === filter.memberId) ?? null : null;
  const answered = new Set(filter?.roundIds ?? []);
  const rounds = focus ? allRounds.filter((round) => answered.has(round.id)) : allRounds;

  return (
    <main className="mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6">
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
          <form method="get" className="pb-1">
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
          </form>
        </details>
        ) : null}
      </LoopNav>

      {notices.opened ? <NoticeFocus>{text(copy.rounds.openedNotice, { number: notices.opened })}</NoticeFocus> : null}
      {notices.alreadyOpen ? <NoticeFocus>{text(copy.rounds.alreadyOpenNotice, { number: notices.alreadyOpen })}</NoticeFocus> : null}
      {notices.named === "1" ? <NoticeFocus>{copy.rounds.nameSaved}</NoticeFocus> : null}
      {notices.named === "0" ? <NoticeFocus>{copy.rounds.nameCleared}</NoticeFocus> : null}

      {rounds.length > 0 ? <ul className="mt-4 flex flex-col gap-3">
        {rounds.map((round) => (
          <li key={round.id} className="card p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-ink">{issueTitle(copy.rounds.round, round.number, round.name)}</h2>
              <span className={`chip flex-none border px-2.5 py-1 text-[12px] font-bold capitalize ${round.status === "open" ? "bg-accent-soft text-accent-ink" : "bg-card text-ink-soft"}`}>
                {copy.common.issueStatus[round.status]}
              </span>
            </div>
            <p className="mt-1 text-[14px] text-ink-soft numeric">
              {round.answers === 1 ? copy.rounds.answer : text(copy.rounds.answers, { count: round.answers })}
              {round.status !== "open" ? ` · ${formatDate(round.deliveredAt ?? round.deliversAt, group.timezone)}` : null}
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
              ) : null}

            {isOwner ? (
              <details className="round-rename">
                <summary aria-label={text(round.name ? copy.a11yLabels.renameNamedRound : copy.a11yLabels.renameRound, { title: issueTitle(copy.rounds.round, round.number, round.name) })} className="link link--quiet cursor-pointer">
                  {round.name ? copy.rounds.renameNamed : copy.rounds.rename}
                </summary>
                <SafeForm action={renameIssueAction} className="mt-1 flex flex-col gap-2">
                  <input type="hidden" name="groupId" value={id} />
                  <input type="hidden" name="issueId" value={round.id} />
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-medium text-ink-soft">{text(copy.rounds.nameLabel, { number: round.number })}</span>
                    <input
                      name="name"
                      defaultValue={round.name ?? ""}
                      maxLength={MAX_ISSUE_NAME}
                      placeholder={copy.rounds.namePlaceholder}
                      className="field h-11 py-0"
                    />
                  </label>
                  <p className="text-[12px] leading-relaxed text-ink-muted">{text(copy.rounds.nameHint, { number: round.number })}</p>
                  <SubmitButton className="btn btn-quiet h-11 min-h-11 self-start text-[14px]">{copy.rounds.nameSave}</SubmitButton>
                </SafeForm>
              </details>
            ) : null}
            </div>

            {round.shareUrl ? (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-dashed border-line-strong bg-field px-3 py-1.5">
                <span className="min-w-0 wrap-any text-[13px] text-ink-soft">
                  {round.shareUrl.replace(/^https?:\/\//, "")}
                </span>
                <CopyLink url={round.shareUrl} />
              </div>
            ) : null}
          </li>
        ))}
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
