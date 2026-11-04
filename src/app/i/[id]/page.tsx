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
import { albumHref } from "@/lib/album-query";
import { printHref, wantsPrint, webHref } from "@/lib/print-view";
import { IssuePrint } from "./issue-print";
import { ReadingControls } from "./reading-controls";
import { applyReading, parseReading, readingPeople } from "@/lib/issue-reading";
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

  // A reply link edits the loop's latest round, before and after it goes out. When
  // that round is this one and the link is the viewer's own, offer the way back.
  const own = m && membership?.replyToken === m ? await resolveToken(m) : null;
  const editHref = own?.state === "ok" && own.issue?.id === view.issue.id ? `/r/${m}` : null;
  const answeredHere =
    view.blocks.some((block) => block.answers.some((answer) => answer.isYou)) ||
    view.sections.some((section) => section.replies.some((reply) => reply.isYou));

  return (
    <main className="mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6">
      <LoopTheme preset={view.group.themePreset} accent={view.group.themeAccent} />
      <LoopBanner url={view.group.headerImageUrl} className="mb-5" />
      <header className="stitched mb-8 flex items-center justify-between gap-3 border-b pb-4">
        <span className="flex min-w-0 items-center gap-2 font-display text-[23px] font-bold text-ink">
          <Cherries className="h-7 w-7 flex-none" /><span className="wrap-any">{view.group.name}</span>
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

      {people.length > 1 ? (
        <ReadingControls base={`/i/${id}`} token={m ?? null} people={people} reading={effective} focus={arranged.focus} />
      ) : null}

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
      />

      {editHref ? (
        <p className="mt-8 text-center text-[14px] text-ink-soft">
          {copy.issue.stillOpen}{" "}
          <Link
            href={editHref}
            className="inline-flex min-h-11 items-center font-bold text-ink underline decoration-line-strong underline-offset-4"
          >
            {answeredHere ? copy.issue.editYourAnswers : copy.issue.addYourAnswers}
          </Link>
        </p>
      ) : null}

      {delivered ? (
        <p className="mt-8 text-center text-[14px] font-bold">
          <Link
            href={printHref(`/i/${id}`, m ?? null)}
            className="inline-flex min-h-11 items-center text-ink underline decoration-line-strong underline-offset-4"
          >
            {copy.print.action}
          </Link>
        </p>
      ) : null}

      {membership ? (
        <p className="mt-4 text-center text-[14px] font-bold">
          <Link
            href={albumHref({ base: `/album/${view.group.id}`, token: m ?? null })}
            className="inline-flex min-h-11 items-center text-ink underline decoration-line-strong underline-offset-4"
          >
            {copy.album.issueLink}
          </Link>
        </p>
      ) : null}

      <p className="mt-4 text-center text-[13px] text-ink-muted">
        <Link href="/" className="underline decoration-line-strong underline-offset-4">
          {copy.common.brand}
        </Link>
      </p>
    </main>
  );
}
