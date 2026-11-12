import Link from "next/link";
import type { Metadata } from "next";
import { leaveContext } from "@/lib/erasure";
import { Tape } from "@/components/stationery";
import { LoopPageHeader, LoopTheme } from "@/components/loop-theme";
import { DeadLinkPage } from "@/components/dead-link";
import { copy, text } from "@/lib/copy";
import { LeaveForm } from "./leave-form";

export const instant = false;

// Same credential rules as the reply sheet: never indexed, never leaked.
export const metadata: Metadata = {
  title: copy.leave.metadataTitle,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** GET only asks; the POST behind the checkbox does the leaving. */
export default async function LeavePage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const context = await leaveContext(token);

  if (!context) {
    return <DeadLinkPage title={copy.reply.invalidTitle} body={copy.reply.invalidBody} next={copy.reply.invalidNext} />;
  }

  const groupName = context.groupName;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center px-4 py-10">
      <LoopTheme group={context.group} />
      <LoopPageHeader name={groupName} imageUrl={context.group.headerImageUrl} />

      {context.isOwner ? (
        <div className="card p-6 pt-8">
          <Tape tone="mint" position="left" />
          <h1 className="text-ink">{text(copy.leave.ownerTitle, { groupName })}</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{copy.leave.ownerBody}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href={`/g/${context.groupId}/settings`} className="btn btn-primary">{copy.leave.ownerAction}</Link>
            <Link href={`/r/${token}`} className="btn btn-quiet">{copy.leave.cancel}</Link>
          </div>
        </div>
      ) : (
        <LeaveForm token={token} groupName={groupName} serverError={Boolean(error)} />
      )}
    </main>
  );
}
