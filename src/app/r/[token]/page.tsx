import Link from "next/link";
import type { Metadata } from "next";
import { describeDeadline } from "@/lib/schedule";
import { resolveToken, sheetFor } from "@/lib/reply";
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

function Closed({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center px-4 py-10">
      <div className="card p-6">
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          {title}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{body}</p>
      </div>
      <p className="mt-6 text-center text-[13px] text-ink-muted">
        <Link href="/" className="underline decoration-line-strong underline-offset-4">
          {copy.common.brand}
        </Link>
      </p>
    </main>
  );
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
      <Closed
        title={text(copy.reply.readerTitle, { groupName: context.groupName })}
        body={copy.reply.readerBody}
      />
    );
  }

  const sheet = await sheetFor(token);
  if (!sheet || !sheet.context.issue) {
    return (
      <Closed
        title={copy.reply.nothingOpenTitle}
        body={text(copy.reply.nothingOpenBody, { groupName: context.group.name })}
      />
    );
  }

  const issue = sheet.context.issue;
  const deadline = describeDeadline(issue.deliversAt, context.group.timezone);

  return (
    <ReplySheet
      token={token}
      loopName={context.group.name}
      loopTimezone={context.group.timezone}
      roundNumber={issue.number}
      deadline={deadline}
      deliversAtIso={issue.deliversAt.toISOString()}
      displayName={context.membership.name ?? context.membership.email.split("@")[0]}
      initialName={context.membership.name}
      questions={sheet.questions.map((question, index) => ({
        id: question.id,
        index: index + 1,
        text: question.text,
        body: question.body,
        photoUrl: question.photoUrl,
        submitted: question.submitted,
      }))}
    />
  );
}
