"use client";

import Link from "next/link";
import { LoopNav } from "@/components/loop-nav";
import { CopyLink } from "@/components/copy-link";
import { NoticeFocus } from "@/components/notice-focus";
import { formatDate } from "@/lib/format";
import { copy, text } from "@/lib/copy";
import { issueTitle, MAX_ISSUE_NAME } from "@/lib/issue-name";
import { renameIssueAction } from "./actions";
import { useLoopData } from "../loop-data";

export default function IssuesTab({
  notices,
  filter,
}: {
  notices: { opened?: string; alreadyOpen?: string; named?: string };
  filter: { memberId: string; roundIds: string[] } | null;
}) {
  const { group, membership, rounds: allRounds, openIssue: open, people } = useLoopData();
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
      <header className="mb-5">
        <Link href={`/g/${id}`} className="text-[13px] font-medium text-ink-soft hover:text-ink">
          ← {group.name}
        </Link>
      </header>
      <LoopNav id={id} active="Rounds" isOwner={membership.access === "owner"} />

      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">{copy.rounds.title}</h1>
      <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">
        {open
          ? open.name
            ? text(copy.rounds.openNamed, { name: open.name })
            : text(copy.rounds.open, { number: open.number })
          : copy.rounds.nothingOpen}
      </p>

      {notices.opened ? <NoticeFocus>{text(copy.rounds.openedNotice, { number: notices.opened })}</NoticeFocus> : null}
      {notices.alreadyOpen ? <NoticeFocus>{text(copy.rounds.alreadyOpenNotice, { number: notices.alreadyOpen })}</NoticeFocus> : null}
      {notices.named === "1" ? <NoticeFocus>{copy.rounds.nameSaved}</NoticeFocus> : null}
      {notices.named === "0" ? <NoticeFocus>{copy.rounds.nameCleared}</NoticeFocus> : null}

      {contributors.length > 1 && allRounds.some((round) => round.status === "delivered") ? (
        <form method="get" className="mt-5 flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-soft">{copy.rounds.filter.label}</span>
            <select name="member" defaultValue={focus?.id ?? ""} className="field h-11 py-0">
              <option value="">{copy.rounds.filter.everyone}</option>
              {contributors.map((person) => (
                <option key={person.id} value={person.id}>{person.name}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-quiet h-11 text-[14px]">{copy.rounds.filter.apply}</button>
        </form>
      ) : null}
      {focus ? (
        <p role="status" className="mt-3 text-[14px] leading-relaxed text-ink-soft">
          {text(copy.rounds.filter.showing, { name: focus.name })}{" "}
          {open ? copy.rounds.filter.openHidden : null}{" "}
          <Link href={`/g/${id}/issues`} className="inline-flex min-h-11 items-center font-bold text-ink underline decoration-line-strong underline-offset-4">
            {copy.rounds.filter.clear}
          </Link>
        </p>
      ) : null}

      {rounds.length > 0 ? <ul className="mt-5 flex flex-col gap-2.5">
        {rounds.map((round) => (
          <li key={round.id} className="card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[15px] font-medium text-ink">{issueTitle(copy.rounds.round, round.number, round.name)}</p>
              <span className="rounded-full border border-line px-2.5 py-1 text-[12px] font-medium capitalize text-ink-soft">
                {copy.common.issueStatus[round.status]}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-ink-muted numeric">
              {round.answers === 1 ? copy.rounds.answer : text(copy.rounds.answers, { count: round.answers })}
            </p>
            {round.status !== "open" ? (
              <p className="mt-0.5 text-[12px] text-ink-muted">
                {formatDate(round.deliveredAt ?? round.deliversAt, group.timezone)}
              </p>
            ) : null}

            {isOwner ? (
              <details className="mt-2">
                <summary aria-label={text(copy.a11yLabels.renameRound, { title: issueTitle(copy.rounds.round, round.number, round.name) })} className="inline-flex min-h-11 cursor-pointer items-center text-[14px] font-medium text-ink-soft underline decoration-dashed underline-offset-4">
                  {copy.rounds.rename}
                </summary>
                <form action={renameIssueAction} className="mt-1 flex flex-col gap-2">
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
                  <button type="submit" className="btn btn-quiet h-10 self-start text-[14px]">{copy.rounds.nameSave}</button>
                </form>
              </details>
            ) : null}

            {round.status !== "open" ? (
              <Link
                href={focus ? `/i/${round.id}?by=${focus.id}` : `/i/${round.id}`}
                aria-label={text(copy.a11yLabels.readRound, { title: issueTitle(copy.rounds.round, round.number, round.name) })}
                className="mt-2 inline-block text-[14px] font-medium text-accent-ink hover:underline"
              >
                {copy.rounds.read}
              </Link>
            ) : null}

            {round.shareUrl ? (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-field px-2.5 py-1.5">
                <span className="min-w-0 wrap-any text-[12px] text-ink-muted">
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
