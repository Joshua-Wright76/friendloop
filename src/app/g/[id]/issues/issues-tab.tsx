"use client";

import Link from "next/link";
import { LoopNav } from "@/components/loop-nav";
import { copy, text } from "@/lib/copy";
import { useLoopData } from "../loop-data";

export default function IssuesTab({ notices }: { notices: { opened?: string } }) {
  const { group, membership, rounds, openIssue: open } = useLoopData();
  const id = group.id;

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
        {open ? text(copy.rounds.open, { number: open.number }) : copy.rounds.nothingOpen}
      </p>

      {notices.opened ? <Notice>{text(copy.rounds.openedNotice, { number: notices.opened })}</Notice> : null}

      <div className="mt-5 flex flex-col gap-2.5">
        {rounds.map((round) => (
          <div key={round.id} className="card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[15px] font-medium text-ink">{text(copy.rounds.round, { number: round.number })}</p>
              <span className="rounded-full border border-line px-2.5 py-1 text-[12px] font-medium capitalize text-ink-soft">
                {copy.common.issueStatus[round.status]}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-ink-muted numeric">
              {round.answers === 1 ? copy.rounds.answer : text(copy.rounds.answers, { count: round.answers })}
            </p>

            {round.status !== "open" ? (
              <Link
                href={`/i/${round.id}`}
                className="mt-2 inline-block text-[14px] font-medium text-accent hover:underline"
              >
                {copy.rounds.read}
              </Link>
            ) : null}

            {round.shareUrl ? (
              <p className="mt-2 break-all text-[12px] text-ink-muted">
                {text(copy.rounds.shareLink, { url: round.shareUrl })}
              </p>
            ) : null}
          </div>
        ))}
        {rounds.length === 0 ? (
          <div className="card p-5 text-[14px] text-ink-muted">
            <p>{copy.rounds.empty}</p>
            {membership.access !== "member" ? <Link href={`/g/${id}`} className="btn btn-primary mt-4 inline-flex">{copy.rounds.firstRoundAction}</Link> : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="notice settle mt-4 border bg-accent-soft px-4 py-3 text-[14px] leading-relaxed">
      {children}
    </div>
  );
}
