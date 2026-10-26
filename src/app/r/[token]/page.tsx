import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { describeDeadline } from "@/lib/schedule";
import { resolveToken, sheetFor } from "@/lib/reply";
import { ReplySheet } from "./reply-sheet";
import { copy, text } from "@/lib/copy";
import { resolveIssueTheme } from "@/lib/issue-experience";

// One indexed query behind this page; a blocking route is faster than a skeleton.
export const instant = false;

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

  const [viewer] = context.membership.userId
    ? await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, context.membership.userId)).limit(1)
    : [];

  const issue = sheet.context.issue;
  const deadline = describeDeadline(issue.deliversAt, context.group.timezone, viewer?.timezone);

  return (
    <ReplySheet
      token={token}
      loopName={context.group.name}
      roundNumber={issue.number}
      deadline={deadline}
      displayName={context.membership.name ?? context.membership.email.split("@")[0]}
      theme={resolveIssueTheme(issue.theme, context.group.theme)}
      mood={sheet.mood}
      questions={sheet.questions.map((question, index) => ({
        id: question.id,
        index: index + 1,
        text: question.text,
        kind: question.kind,
        body: question.body,
        photoUrl: question.photoUrl,
        submitted: question.submitted,
      }))}
    />
  );
}
