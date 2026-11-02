import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadIssue } from "@/lib/issue-view";
import { formatDate } from "@/lib/format";
import { IssueBody } from "../../i/[id]/issue-body";
import { Cherries } from "@/components/stationery";
import { copy, text } from "@/lib/copy";
import { issueTitle } from "@/lib/issue-name";
import { LoopBanner, LoopTheme } from "@/components/loop-theme";
import { printHref, wantsPrint, webHref } from "@/lib/print-view";
import { IssuePrint } from "../../i/[id]/issue-print";

export const instant = false;

// A secret link, by contract: never indexed, and never sent as a Referer.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function SharePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ print?: string | string[] }>;
}) {
  const { token } = await params;
  const { print } = await searchParams;
  const view = await loadIssue({ shareToken: token, viewerMembershipId: null });
  if (!view) notFound();

  // Only delivered rounds have a share link at all, so the print view is always a keepsake.
  if (wantsPrint(print)) {
    return (
      <IssuePrint
        view={view}
        roundTemplate={copy.share.round}
        eyebrow={copy.print.eyebrow}
        answersLine={view.answerCount === 1 ? copy.share.answer : text(copy.share.answers, { count: view.answerCount })}
        deliveredLine={text(copy.share.deliveredOn, {
          date: formatDate(view.issue.deliveredAt ?? view.issue.deliversAt, view.group.timezone),
        })}
        backHref={webHref(`/s/${token}`)}
      />
    );
  }

  return (
    <main className="mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6">
      <LoopTheme preset={view.group.themePreset} accent={view.group.themeAccent} />
      <LoopBanner url={view.group.headerImageUrl} className="mb-5" />
      <header className="stitched mb-8 flex items-center justify-between gap-3 border-b pb-4">
        <span className="flex min-w-0 items-center gap-2 font-display text-[23px] font-bold text-ink">
          <Cherries className="h-7 w-7 flex-none" /><span className="truncate">{view.group.name}</span>
        </span>
        <span className="chip border bg-card px-2.5 py-1 text-[12px] font-bold text-ink-soft numeric">{text(copy.share.round, { number: view.issue.number })}</span>
      </header>

      <div className="relative pr-16">
        <Cherries className="absolute -top-2 right-0 h-16 w-16 rotate-12" />
        <p className="eyebrow">{copy.share.eyebrow}</p>
        <h1 className="mt-1 text-ink">{issueTitle(copy.share.round, view.issue.number, view.issue.name)}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
          {view.answerCount === 1 ? copy.share.answer : text(copy.share.answers, { count: view.answerCount })}
        </p>
        <p className="mt-1 text-[13px] text-ink-muted">
          {text(copy.share.deliveredOn, {
            date: formatDate(view.issue.deliveredAt ?? view.issue.deliversAt, view.group.timezone),
          })}
        </p>
      </div>

      <IssueBody
        issueId={view.issue.id}
        viewerToken={null}
        canInteract={false}
        blocks={view.blocks}
        sections={view.sections}
        comments={[]}
        commentsEnabled={false}
        mentionables={[]}
      />

      <p className="mt-8 text-center text-[14px] font-bold">
        <Link
          href={printHref(`/s/${token}`)}
          className="inline-flex min-h-11 items-center text-ink underline decoration-line-strong underline-offset-4"
        >
          {copy.print.action}
        </Link>
      </p>

      <p className="mt-4 text-center text-[13px] text-ink-muted">
        {copy.share.sharedFrom}{" "}
        <Link href="/" className="underline decoration-line-strong underline-offset-4">
          {copy.common.brand}
        </Link>
      </p>
    </main>
  );
}
