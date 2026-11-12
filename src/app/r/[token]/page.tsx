import { videoUploadMode } from "@/lib/video-storage";
import { DeadLinkAction } from "@/components/dead-link";
import type { Metadata } from "next";
import Link from "next/link";
import { formatMoment } from "@/lib/format";
import { resolveToken, sheetFor } from "@/lib/reply";
import { currentUser } from "@/lib/auth";
import { LoopTheme } from "@/components/loop-theme";
import { ProfilePhoto } from "@/components/profile-photo";
import { Brand, Tape } from "@/components/stationery";
import { ReplySheet } from "./reply-sheet";
import { MutedNotice } from "@/components/muted-notice";
import { copy, text } from "@/lib/copy";
import { marksOf, parseSignature } from "@/lib/looks";

// One indexed query behind this page; a blocking route is faster than a skeleton.
export const instant = false;

// A reply link is a credential. It must never appear in a search index, and it
// must never leak through a Referer header if someone pastes it elsewhere.
export const metadata: Metadata = {
  title: copy.pageTitles.reply,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Person = { token: string; name: string; photoUrl: string | null; charm: string | null; frame: string | null; signature: number[][] | null };

function Closed({ title, body, next, person, leaveHref, action, children }: { title: string; body: string; next?: string; person?: Person; leaveHref?: string; action?: React.ReactNode; children?: React.ReactNode }) {
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
        {action}
        {person ? (
          // Someone following their invitation may land before any round is open (or
          // as a reader). Their photo is still theirs to set, so it is offered here.
          <div className="mt-4 border-t border-dashed border-line pt-4">
            <p className="mb-2 text-[13px] font-medium text-ink-soft">{copy.identity.profile.title}</p>
            <ProfilePhoto endpoint={`/api/reply/${person.token}/profile-photo`} name={person.name} photoUrl={person.photoUrl} charm={person.charm} frame={person.frame} signature={person.signature} />
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

function personOf(token: string, membership: { name: string | null; email: string; photoUrl: string | null; charm: string | null; avatarFrame: string | null; signature: unknown }): Person {
  return { token, name: membership.name ?? membership.email.split("@")[0], photoUrl: membership.photoUrl, charm: membership.charm, frame: membership.avatarFrame, signature: parseSignature(membership.signature) };
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
        action={<DeadLinkAction />}
      />
    );
  }

  if (context.state === "reader") {
    return (
      <>
        <LoopTheme group={context.group} />
        <Closed
          title={text(copy.reply.readerTitle, { groupName: context.groupName })}
          body={copy.reply.readerBody}
          person={personOf(token, context.membership)}
          leaveHref={`/r/${token}/leave`}
        />
      </>
    );
  }

  const [sheet, user] = await Promise.all([sheetFor(token), currentUser()]);
  if (!sheet || !sheet.context.issue) {
    return (
      <>
        <LoopTheme group={context.group} />
        <Closed
          title={context.group.pausedAt ? copy.reply.pausedTitle : copy.reply.nothingOpenTitle}
          body={text(context.group.pausedAt ? copy.reply.pausedBody : copy.reply.nothingOpenBody, { groupName: context.group.name })}
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

  return (
    <>
    <LoopTheme group={context.group} />
    <ReplySheet
      token={token}
      loopName={context.group.name}
      // Only the account this link belongs to can open the loop page, so only it is offered the way there.
      loopHref={user && user.id === context.membership.userId ? `/g/${context.group.id}` : null}
      loopTimezone={context.group.timezone}
      roundNumber={issue.number}
      roundName={issue.name}
      headerImageUrl={context.group.headerImageUrl}
      photoUrl={context.membership.photoUrl}
      charm={context.membership.charm}
      frame={context.membership.avatarFrame}
      signature={parseSignature(context.membership.signature)}
      statusLine={sheet.line}
      deadlineMoment={formatMoment(issue.deliversAt, context.group.timezone)}
      deliversAtIso={issue.deliversAt.toISOString()}
      displayName={context.membership.name ?? context.membership.email.split("@")[0]}
      initialName={context.membership.name}
      reminderPreference={context.membership.reminderPreference}
      mutedUnsubscribeToken={context.membership.mutedAt ? context.membership.unsubscribeToken : null}
      celebration={marksOf(context.group).celebration}
      mascot={context.group.themeMascot}
      videoUploadMode={videoUploadMode()}
      questions={sheet.questions.map((question, index) => ({
        id: question.id,
        index: index + 1,
        text: question.text,
        emoji: question.emoji,
        description: question.description,
        format: question.format,
        voice: !question.fromSection,
        legacyId: question.legacyId,
        linkUrl: question.linkUrl,
        linkProvider: question.linkProvider,
        media: question.media,
        body: question.body,
        photoUrl: question.photoUrl,
        audioUrl: question.audioUrl,
        audioDurationMs: question.audioDurationMs,
        video: question.videoUrl && question.videoPosterUrl
          ? { url: question.videoUrl, posterUrl: question.videoPosterUrl, durationMs: question.videoDurationMs ?? 0 }
          : null,
        kind: question.kind,
        pollMultiple: question.pollMultiple,
        pollOptions: question.pollOptions,
        pollChoices: question.pollChoices,
        sticker: question.sticker,
      }))}
    />
    </>
  );
}
