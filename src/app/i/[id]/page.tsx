import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { issueGroupId, loadIssue, membershipForViewer } from "@/lib/issue-view";
import { MutedNotice } from "@/components/muted-notice";
import { formatDate } from "@/lib/format";
import { IssueBody } from "./issue-body";
import { Cherries } from "@/components/stationery";
import { DocumentTitle } from "@/components/document-title";
import { copy, text } from "@/lib/copy";
import { issueTitle } from "@/lib/issue-name";
import { LoopSnapshot, LoopTheme } from "@/components/loop-theme";
import { albumHref } from "@/lib/album-query";
import { printHref, wantsPrint, webHref } from "@/lib/print-view";
import { IssuePrint } from "./issue-print";
import { ReadingControls } from "./reading-controls";
import { applyReading, parseReading, readingHref, readingPeople } from "@/lib/issue-reading";
import { resolveToken } from "@/lib/reply";

export const instant = false;

export const metadata: Metadata = {
  title: copy.pageTitles.round,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function IssuePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ m?: string; print?: string | string[]; by?: string | string[]; sort?: string | string[] }>;
}) {
  const { id } = await params;
  const { m, print, by, sort } = await searchParams;

  // Who is reading decides what loads, and that needs only the issue's loop.
  const [user, groupId] = await Promise.all([currentUser(), issueGroupId(id)]);
  if (!groupId) notFound();

  const membership = await membershipForViewer({
    groupId,
    userId: user?.id ?? null,
    token: m ?? null,
  });

  // A reply link edits the loop's latest round, before and after it goes out; this
  // is asked alongside the round rather than after it.
  const [view, own] = await Promise.all([
    loadIssue({
      issueId: id,
      viewerMembershipId: membership?.id ?? null,
      viewerIsAdmin: membership?.access === "owner" || membership?.access === "admin",
    }),
    m && membership?.replyToken === m ? resolveToken(m) : Promise.resolve(null),
  ]);
  if (!view) notFound();

  const delivered = view.issue.status === "delivered";

  // A keepsake is only ever made of a round that has gone out. An open round asked
  // for as `?print` is simply the round.
  if (delivered && wantsPrint(print)) {
    // Names, not "You": whoever opens this paper is not the person who wrote it.
    const printable = await loadIssue({
      issueId: id,
      viewerMembershipId: null,
      viewerIsAdmin: membership?.access === "owner" || membership?.access === "admin",
    });
    if (!printable) notFound();
    return (
      <IssuePrint
        view={printable}
        roundTemplate={copy.issue.round}
        eyebrow={copy.print.eyebrow}
        answersLine={printable.answerCount === 1 ? copy.issue.answer : text(copy.issue.answers, { count: printable.answerCount })}
        deliveredLine={text(copy.issue.deliveredOn, {
          date: formatDate(printable.issue.deliveredAt ?? printable.issue.deliversAt, printable.group.timezone),
        })}
        backHref={webHref(`/i/${id}`, m ?? null)}
      />
    );
  }

  // How to read it: everyone's answers question by question (the default), or one
  // person's, or grouped by person. A choice that names nobody here is no choice.
  const reading = parseReading({ by, sort });
  const people = readingPeople(view);
  const arranged = applyReading(view, reading);
  const effective = { by: arranged.focus?.id ?? null, sort: reading.sort };

  // When the reply link's round is this one and the link is the viewer's own, offer the way back.
  const editHref = own?.state === "ok" && own.issue?.id === view.issue.id ? `/r/${m}` : null;
  const answeredHere =
    view.blocks.some((block) => block.answers.some((answer) => answer.isYou)) ||
    view.sections.some((section) => section.replies.some((reply) => reply.isYou));

  return (
    <main className="mx-auto w-full max-w-[680px] px-4 pb-16 pt-4 sm:px-6">
      <DocumentTitle value={`${issueTitle(copy.issue.round, view.issue.number, view.issue.name)} · ${view.group.name}`} />
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
          <h1>{issueTitle(copy.issue.round, view.issue.number, view.issue.name)}</h1>
          <p className="numeric">
            {view.issue.name ? `${text(copy.issue.round, { number: view.issue.number })}. ` : null}
            {view.answerCount === 1 ? copy.issue.answer : text(copy.issue.answers, { count: view.answerCount })}{" "}
            {text(view.issue.status === "open" ? copy.issue.goesOutOn : copy.issue.deliveredOn, {
              date: formatDate(view.issue.deliveredAt ?? view.issue.deliversAt, view.group.timezone),
            })}
          </p>
        </div>
      </header>

      <IssueBody
        issueId={view.issue.id}
        viewerToken={m ?? null}
        canInteract={Boolean(membership)}
        blocks={arranged.blocks}
        sections={arranged.sections}
        groups={arranged.groups}
        comments={view.comments}
        commentsEnabled={view.commentsEnabled}
        mentionables={view.mentionables}
        editHref={editHref}
        barTitle={issueTitle(copy.issue.round, view.issue.number, view.issue.name)}
        reading={people.length > 1 ? (
          <ReadingControls base={`/i/${id}`} token={m ?? null} people={people} reading={effective} focus={arranged.focus} />
        ) : undefined}
        readingLabel={text(copy.issue.reading.menuLabel, {
          who: arranged.focus?.name ?? copy.issue.reading.everyoneLower,
          order: effective.sort === "member" ? copy.issue.reading.byPersonLower : copy.issue.reading.byQuestionLower,
        })}
        readingNote={arranged.focus ? (
          <p role="status" className="card m-0 flex flex-wrap items-center gap-x-3 px-4 py-1 text-[14px] text-ink-soft">
            {text(copy.issue.reading.showing, { name: arranged.focus.name })}
            <Link href={readingHref(`/i/${id}`, m ?? null, { ...effective, by: null })} className="link">{copy.issue.reading.showEveryone}</Link>
          </p>
        ) : undefined}
      />

      <footer className="card mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-0 px-4 py-2">
        {editHref ? (
          <Link href={editHref} className="link">
            {answeredHere ? copy.issue.editYourAnswers : copy.issue.addYourAnswers}
          </Link>
        ) : null}
        {delivered ? (
          <Link href={printHref(`/i/${id}`, m ?? null)} className="link link--quiet">
            {copy.print.action}
          </Link>
        ) : null}
        {membership ? (
          <Link href={albumHref({ base: `/album/${view.group.id}`, token: m ?? null })} className="link link--quiet">
            {copy.album.issueLink}
          </Link>
        ) : null}
        <Link href="/" className="link link--quiet">{copy.common.brand}</Link>
      </footer>

      {membership?.mutedAt ? (
        <MutedNotice
          unsubscribeToken={membership.unsubscribeToken}
          back={m ? `/i/${id}?m=${encodeURIComponent(m)}` : `/i/${id}`}
        />
      ) : null}

    </main>
  );
}
