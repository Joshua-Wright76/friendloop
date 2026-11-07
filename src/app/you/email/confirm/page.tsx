import Link from "next/link";
import type { Metadata } from "next";
import { SafeForm } from "@/components/safe-form";
import { SubmitButton } from "@/components/submit-button";
import { Brand, Tape } from "@/components/stationery";
import { peekEmailChange } from "@/lib/account";
import { copy } from "@/lib/copy";
import { confirmEmailChangeAction } from "./actions";

export const instant = false;

export const metadata: Metadata = {
  title: copy.pageTitles.confirmEmail,
  robots: { index: false, follow: false },
};

const PROBLEMS: Record<string, { title: string; body: string }> = copy.emailChangeConfirm.problems;

/** A page with a button, not a link that does it: mail scanners open links. */
export default async function ConfirmEmailPage({ searchParams }: {
  searchParams: Promise<{ token?: string; done?: string; problem?: string }>;
}) {
  const c = copy.emailChangeConfirm;
  const { token, done, problem } = await searchParams;
  const peek = token && !done ? await peekEmailChange(token) : null;
  const failure = done
    ? null
    : problem
      ? PROBLEMS[problem] ?? PROBLEMS.unknown
      : !peek
        ? PROBLEMS.unknown
        : peek.state !== "valid"
          ? PROBLEMS[peek.state]
          : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center px-4 py-10">
      <div className="mb-8 self-start"><Brand /></div>
      <div className="card p-6 pt-8">
        <Tape tone="stripe" position="center" />
        {done || failure ? (
          <>
            <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.022em] text-ink">
              {done ? c.doneTitle : failure?.title}
            </h1>
            <p className="mb-5 mt-2 text-[15px] leading-relaxed text-ink-soft">{done ? c.doneBody : failure?.body}</p>
            <Link href="/you" className="btn btn-primary w-full">{c.back}</Link>
          </>
        ) : (
          <>
            <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.022em] text-ink">{c.title}</h1>
            <p className="mb-5 mt-1.5 text-[15px] leading-relaxed text-ink-soft">
              {c.moving}{" "}
              <strong className="block font-extrabold text-ink [overflow-wrap:anywhere]">
                {peek?.state === "valid" ? peek.newEmail : ""}
              </strong>
            </p>
            <SafeForm action={confirmEmailChangeAction}>
              <input type="hidden" name="token" value={token ?? ""} />
              <SubmitButton className="btn btn-primary w-full">{c.submit}</SubmitButton>
            </SafeForm>
          </>
        )}
      </div>
    </main>
  );
}
