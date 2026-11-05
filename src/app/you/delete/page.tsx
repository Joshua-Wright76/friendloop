import { SafeForm } from "@/components/safe-form";
import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { accountDeletionPlan } from "@/lib/erasure";
import { Brand, Tape } from "@/components/stationery";
import { copy, text } from "@/lib/copy";
import { deleteAccountAction } from "./actions";

export const instant = false;

export const metadata: Metadata = {
  title: copy.account.metadataTitle,
  robots: { index: false, follow: false },
};

/** GET only shows the question; the deletion is the form's POST. */
export default async function DeleteAccountPage({ searchParams }: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const plan = await accountDeletionPlan(user.id);
  if (!plan) redirect("/signin");
  const { error } = await searchParams;

  return (
    <main className="mx-auto w-full max-w-[640px] px-4 pb-16 pt-6 sm:px-6">
      <header className="mb-8 flex items-center justify-between gap-3">
        <Brand href="/you" />
        <Link href="/you" className="text-[14px] font-bold text-ink-soft underline decoration-dashed underline-offset-4 hover:text-ink">
          {copy.common.yourLoops}
        </Link>
      </header>

      <div className="card border-danger/30 p-6 pt-8">
        <Tape tone="stripe" position="left" />
        <p className="eyebrow">{copy.account.eyebrow}</p>
        <h1 className="mt-1 text-ink">{copy.account.title}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{copy.account.intro}</p>
        <p className="mt-3 text-[14px] text-ink-soft">
          {copy.account.downloadFirst}{" "}
          <a href="/you/export" download className="font-bold text-ink underline decoration-line-strong underline-offset-4">
            {copy.account.download}
          </a>
        </p>

        {error ? (
          <p role="alert" className="notice mt-4 border border-danger/40 bg-danger/10 px-4 py-3 text-[14px] text-danger">
            {error === "owner" ? copy.account.ownerError : copy.account.confirmError}
          </p>
        ) : null}

        {plan.blocking.length > 0 ? (
          <section aria-labelledby="blocked" className="mt-6">
            <h2 id="blocked" className="text-[20px] text-ink">{copy.account.blockedTitle}</h2>
            <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.account.blockedBody}</p>
            <ul className="mt-3 grid gap-3">
              {plan.blocking.map((loop) => (
                <li key={loop.groupId} className="rounded-md border border-line px-4 py-3">
                  <p className="font-bold text-ink">{loop.name}</p>
                  <p className="text-[13px] text-ink-muted">
                    {loop.others === 1 ? copy.account.blockedPerson : text(copy.account.blockedPeople, { count: loop.others })}
                  </p>
                  <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
                    <Link href={`/g/${loop.groupId}/members`} className="font-bold text-ink underline decoration-line-strong underline-offset-4">
                      {copy.account.handOn}
                    </Link>
                    <Link href={`/g/${loop.groupId}/settings`} className="font-bold text-ink underline decoration-line-strong underline-offset-4">
                      {copy.account.deleteLoop}
                    </Link>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <SafeForm action={deleteAccountAction} className="mt-6">
            {plan.solo.length > 0 ? (
              <div className="mb-5">
                <p className="text-[14px] font-bold text-ink">{copy.account.soloTitle}</p>
                <ul className="mt-2 list-disc pl-5 text-[14px] text-ink-soft">
                  {plan.solo.map((loop) => <li key={loop.groupId}>{loop.name}</li>)}
                </ul>
              </div>
            ) : null}
            <label htmlFor="confirm" className="block text-[14px] font-bold text-ink">{copy.account.confirmLabel}</label>
            <p id="confirm-hint" className="mt-1 text-[13px] text-ink-muted [overflow-wrap:anywhere]">
              {text(copy.account.confirmHint, { email: user.email })}
            </p>
            <input
              id="confirm"
              name="confirm"
              type="email"
              required
              autoComplete="off"
              aria-describedby="confirm-hint"
              className="field mt-2 h-[46px] py-0"
            />
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="submit" className="btn btn-danger hover:opacity-90">{copy.account.submit}</button>
              <Link href="/you" className="btn btn-quiet">{copy.account.cancel}</Link>
            </div>
          </SafeForm>
        )}
      </div>
    </main>
  );
}
