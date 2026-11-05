import { SafeForm } from "@/components/safe-form";
import Link from "next/link";
import type { Metadata } from "next";
import { leaveContext } from "@/lib/erasure";
import { Brand, Tape } from "@/components/stationery";
import { copy, text } from "@/lib/copy";
import { leaveLoopAction } from "./actions";

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
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center px-4 py-10">
        <div className="card p-6">
          <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">{copy.reply.invalidTitle}</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{copy.reply.invalidBody}</p>
        </div>
      </main>
    );
  }

  const groupName = context.groupName;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center px-4 py-10">
      <div className="mb-8 self-start">
        <Brand href={null} />
      </div>

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
        <SafeForm action={leaveLoopAction} className="card border-danger/30 p-6 pt-8">
          <Tape tone="stripe" position="left" />
          <input type="hidden" name="token" value={token} />
          <p className="eyebrow">{text(copy.leave.eyebrow, { groupName })}</p>
          <h1 className="mt-1 text-ink">{text(copy.leave.title, { groupName })}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{copy.leave.body}</p>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">{text(copy.leave.otherLoops, { groupName })}</p>
          <p className="mt-3 text-[14px] text-ink-soft">
            {copy.leave.downloadFirst}{" "}
            <a href={`/r/${token}/export`} download className="font-bold text-ink underline decoration-line-strong underline-offset-4">
              {copy.leave.download}
            </a>
          </p>

          {error ? (
            <p role="alert" className="notice mt-4 border border-danger/40 bg-danger/10 px-4 py-3 text-[14px] text-danger">
              {copy.leave.confirmError}
            </p>
          ) : null}

          <label className="mt-5 flex min-h-11 items-start gap-3 text-[15px] leading-snug text-ink">
            <input type="checkbox" name="confirm" required className="mt-1 h-5 w-5 flex-none accent-[var(--danger)]" />
            <span>{text(copy.leave.confirmLabel, { groupName })}</span>
          </label>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="submit" className="btn btn-danger hover:opacity-90">{copy.leave.submit}</button>
            <Link href={`/r/${token}`} className="btn btn-quiet">{copy.leave.cancel}</Link>
          </div>
        </SafeForm>
      )}
    </main>
  );
}
