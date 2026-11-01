import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { loadIssue, membershipForViewer } from "@/lib/issue-view";
import { formatDate } from "@/lib/format";
import { IssueBody } from "./issue-body";
import { Cherries } from "@/components/stationery";
import { copy, text } from "@/lib/copy";
import { issueTitle } from "@/lib/issue-name";
import { LoopBanner, LoopTheme } from "@/components/loop-theme";

export const instant = false;

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function IssuePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ m?: string }>;
}) {
  const { id } = await params;
  const { m } = await searchParams;

  const user = await currentUser();
  const probe = await loadIssue({ issueId: id });
  if (!probe) notFound();

  const membership = await membershipForViewer({
    groupId: probe.group.id,
    userId: user?.id ?? null,
    token: m ?? null,
  });

  const view = await loadIssue({
    issueId: id,
    viewerMembershipId: membership?.id ?? null,
    viewerIsAdmin: membership?.access === "owner" || membership?.access === "admin",
  });
  if (!view) notFound();

  return (
    <main className="mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6">
      <LoopTheme preset={view.group.themePreset} accent={view.group.themeAccent} />
      <LoopBanner url={view.group.headerImageUrl} className="mb-5" />
      <header className="stitched mb-8 flex items-center justify-between gap-3 border-b pb-4">
        <span className="flex min-w-0 items-center gap-2 font-display text-[23px] font-bold text-ink">
          <Cherries className="h-7 w-7 flex-none" /><span className="truncate">{view.group.name}</span>
        </span>
        <span className="chip border bg-card px-2.5 py-1 text-[12px] font-bold text-ink-soft numeric">{text(copy.issue.round, { number: view.issue.number })}</span>
      </header>

      <div className="relative pr-16">
        <Cherries className="absolute -top-2 right-0 h-16 w-16 rotate-12" />
        <p className="eyebrow">{copy.issue.eyebrow}</p>
        <h1 className="mt-1 text-ink">{issueTitle(copy.issue.round, view.issue.number, view.issue.name)}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
          {view.answerCount === 1 ? copy.issue.answer : text(copy.issue.answers, { count: view.answerCount })}
        </p>
        <p className="mt-1 text-[13px] text-ink-muted">
          {text(copy.issue.deliveredOn, {
            date: formatDate(view.issue.deliveredAt ?? view.issue.deliversAt, view.group.timezone),
          })}
        </p>
      </div>

      <IssueBody
        issueId={view.issue.id}
        viewerToken={m ?? null}
        canInteract={Boolean(membership)}
        blocks={view.blocks}
        sections={view.sections}
        comments={view.comments}
        commentsEnabled={view.commentsEnabled}
        mentionables={view.mentionables}
      />

      <p className="mt-8 text-center text-[13px] text-ink-muted">
        <Link href="/" className="underline decoration-line-strong underline-offset-4">
          {copy.common.brand}
        </Link>
      </p>
    </main>
  );
}
