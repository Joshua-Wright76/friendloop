import type { Metadata } from "next";
import Link from "next/link";
import { formatMoment } from "@/lib/format";
import { resolveToken, sheetFor } from "@/lib/reply";
import { sectionsForSheet } from "@/lib/sections";
import { LoopTheme } from "@/components/loop-theme";
import { ProfilePhoto } from "@/components/profile-photo";
import { Brand, Tape } from "@/components/stationery";
import { ReplySheet } from "./reply-sheet";
import { MutedNotice } from "@/components/muted-notice";
import { copy, text } from "@/lib/copy";

// One indexed query behind this page; a blocking route is faster than a skeleton.
export const instant = false;

// A reply link is a credential. It must never appear in a search index, and it
// must never leak through a Referer header if someone pastes it elsewhere.
export const metadata: Metadata = {
  title: copy.pageTitles.reply,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Person = { token: string; name: string; photoUrl: string | null };

function Closed({ title, body, next, person, leaveHref, children }: { title: string; body: string; next?: string; person?: Person; leaveHref?: string; children?: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center px-4 py-10">
      <div className="mb-8 self-start"><Brand /></div>
      <div className="card p-6 pt-8">
        <Tape tone="stripe" position="center" />
        <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.022em] text-ink">
          {title}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{body}</p>
        {next ? <p className="mt-3 text-[15px] font-bold leading-relaxed text-ink">{next}</p> : null}
        {person ? (
          // Someone following their invitation may land before any round is open (or
          // as a reader). Their photo is still theirs to set, so it is offered here.
          <div className="mt-4 border-t border-dashed border-line pt-4">
            <p className="mb-2 text-[13px] font-medium text-ink-soft">{copy.identity.profile.title}</p>
            <ProfilePhoto endpoint={`/api/reply/${person.token}/profile-photo`} name={person.name} photoUrl={person.photoUrl} />
          </div>
        ) : null}
      </div>
      {children}
      {leaveHref ? (
        <p className="mt-6 text-center text-[13px] text-ink-muted">
          <Link href={leaveHref} className="underline decoration-line-strong underline-offset-4">
            {copy.reply.leaveLink}
          </Link>
        </p>
      ) : null}
    </main>
  );
}

function personOf(token: string, membership: { name: string | null; email: string; photoUrl: string | null }): Person {
  return { token, name: membership.name ?? membership.email.split("@")[0], photoUrl: membership.photoUrl };
}

export default async function ReplyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const context = await resolveToken(token);

  if (context.state === "invalid") {
    return (
      <Closed
        title={copy.reply.invalidTitle}
        body={copy.reply.invalidBody}
        next={copy.reply.invalidNext}
      />
    );
  }

  if (context.state === "expired") {
    return (
      <Closed
        title={copy.reply.expiredTitle}
        body={text(copy.reply.expiredBody, { groupName: context.groupName })}
      />
    );
  }

  if (context.state === "reader") {
    return (
      <>
        <LoopTheme preset={context.group.themePreset} accent={context.group.themeAccent} />
        <Closed
          title={text(copy.reply.readerTitle, { groupName: context.groupName })}
          body={copy.reply.readerBody}
          person={personOf(token, context.membership)}
          leaveHref={`/r/${token}/leave`}
        />
      </>
    );
  }

  const sheet = await sheetFor(token);
  if (!sheet || !sheet.context.issue) {
    return (
      <>
        <LoopTheme preset={context.group.themePreset} accent={context.group.themeAccent} />
        <Closed
          title={copy.reply.nothingOpenTitle}
          body={text(copy.reply.nothingOpenBody, { groupName: context.group.name })}
          person={personOf(token, context.membership)}
          leaveHref={`/r/${token}/leave`}
        >
          {context.membership.mutedAt ? (
            <MutedNotice unsubscribeToken={context.membership.unsubscribeToken} back={`/r/${token}`} />
          ) : null}
        </Closed>
      </>
    );
  }

  const issue = sheet.context.issue;
  const sections = await sectionsForSheet(token, issue.id);

  return (
    <>
    <LoopTheme preset={context.group.themePreset} accent={context.group.themeAccent} />
    <ReplySheet
      token={token}
      canSuggest={context.group.mode !== "from_you"}
      loopName={context.group.name}
      loopTimezone={context.group.timezone}
      roundNumber={issue.number}
      roundName={issue.name}
      headerImageUrl={context.group.headerImageUrl}
      photoUrl={context.membership.photoUrl}
      deadlineMoment={formatMoment(issue.deliversAt, context.group.timezone)}
      deliversAtIso={issue.deliversAt.toISOString()}
      displayName={context.membership.name ?? context.membership.email.split("@")[0]}
      initialName={context.membership.name}
      reminderPreference={context.membership.reminderPreference}
      mutedUnsubscribeToken={context.membership.mutedAt ? context.membership.unsubscribeToken : null}
      sections={sections}
      questions={sheet.questions.map((question, index) => ({
        id: question.id,
        index: index + 1,
        text: question.text,
        body: question.body,
        photoUrl: question.photoUrl,
        audioUrl: question.audioUrl,
        audioDurationMs: question.audioDurationMs,
        kind: question.kind,
        pollMultiple: question.pollMultiple,
        pollOptions: question.pollOptions,
        pollChoices: question.pollChoices,
        submitted: question.submitted,
      }))}
    />
    </>
  );
}
