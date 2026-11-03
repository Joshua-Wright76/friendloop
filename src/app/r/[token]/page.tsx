import Link from "next/link";
import type { Metadata } from "next";
import { describeDeadline } from "@/lib/schedule";
import { resolveToken, sheetFor } from "@/lib/reply";
import { sectionsForSheet } from "@/lib/sections";
import { LoopTheme } from "@/components/loop-theme";
import { ProfilePhoto } from "@/components/profile-photo";
import { ReplySheet } from "./reply-sheet";
import { copy, text } from "@/lib/copy";

// One indexed query behind this page; a blocking route is faster than a skeleton.
export const instant = false;

// A reply link is a credential. It must never appear in a search index, and it
// must never leak through a Referer header if someone pastes it elsewhere.
export const metadata: Metadata = {
  title: copy.common.brand,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Person = { token: string; name: string; photoUrl: string | null };

function Closed({ title, body, person }: { title: string; body: string; person?: Person }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center px-4 py-10">
      <div className="card p-6">
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          {title}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{body}</p>
        {person ? (
          // Someone following their invitation may land before any round is open (or
          // as a reader). Their photo is still theirs to set, so it is offered here.
          <div className="mt-4 border-t border-dashed border-line pt-4">
            <p className="mb-2 text-[13px] font-medium text-ink-soft">{copy.identity.profile.title}</p>
            <ProfilePhoto endpoint={`/api/reply/${person.token}/profile-photo`} name={person.name} photoUrl={person.photoUrl} />
          </div>
        ) : null}
      </div>
      <p className="mt-6 text-center text-[13px] text-ink-muted">
        <Link href="/" className="underline decoration-line-strong underline-offset-4">
          {copy.common.brand}
        </Link>
      </p>
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
        />
      </>
    );
  }

  const issue = sheet.context.issue;
  const sections = await sectionsForSheet(token, issue.id);
  const deadline = describeDeadline(issue.deliversAt, context.group.timezone);

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
      deadline={deadline}
      deliversAtIso={issue.deliversAt.toISOString()}
      displayName={context.membership.name ?? context.membership.email.split("@")[0]}
      initialName={context.membership.name}
      reminderPreference={context.membership.reminderPreference}
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
