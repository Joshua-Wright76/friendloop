import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadIssue } from "@/lib/issue-view";
import { formatDate } from "@/lib/format";
import { IssueBody } from "../../i/[id]/issue-body";
import { Cherries } from "@/components/stationery";
import { copy, text } from "@/lib/copy";
import { issueTitle } from "@/lib/issue-name";
import { LoopSnapshot, LoopTheme } from "@/components/loop-theme";
import { printHref, wantsPrint, webHref } from "@/lib/print-view";
import { IssuePrint } from "../../i/[id]/issue-print";
import { DisplayDigits } from "@/components/display-digits";

export const instant = false;

// A secret link, by contract: never indexed, and never sent as a Referer.
export const metadata: Metadata = {
  title: copy.pageTitles.shared,
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
      <LoopTheme group={view.group} />
      <header className={`loop-head${view.group.headerImageUrl ? " has-snapshot" : ""}`}>
        <LoopSnapshot url={view.group.headerImageUrl} />
        <div className="loop-head__row">
          <span className="loop-head__home">
            <Cherries className="h-7 w-7 flex-none" />
            <span className="loop-head__name wrap-any">{view.group.name}</span>
          </span>
        </div>
        <div className="loop-head__page">
          <h1><DisplayDigits>{issueTitle(copy.share.round, view.issue.number, view.issue.name)}</DisplayDigits></h1>
          <p className="numeric">
            {view.issue.name ? `${text(copy.share.round, { number: view.issue.number })}. ` : null}
            {view.answerCount === 1 ? copy.share.answer : text(copy.share.answers, { count: view.answerCount })}{" "}
            {text(copy.share.deliveredOn, {
              date: formatDate(view.issue.deliveredAt ?? view.issue.deliversAt, view.group.timezone),
            })}
          </p>
          <p className="shared-note">{text(copy.share.sharedNote, { loop: view.group.name })}</p>
        </div>
      </header>

      <IssueBody
        issueId={view.issue.id}
        viewerToken={null}
        canInteract={false}
        blocks={view.blocks}
        sections={view.sections}
        comments={[]}
        barTitle={issueTitle(copy.share.round, view.issue.number, view.issue.name)}
        commentsEnabled={false}
        mentionables={[]}
      />

      <footer className="card mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-0 px-4 py-2 text-[14px] text-ink-soft">
        <Link href={printHref(`/s/${token}`)} className="link link--quiet">{copy.print.action}</Link>
        <span>
          {copy.share.sharedFrom}{" "}
          <Link href="/" className="link link--quiet">{copy.common.brand}</Link>
        </span>
      </footer>
    </main>
  );
}
