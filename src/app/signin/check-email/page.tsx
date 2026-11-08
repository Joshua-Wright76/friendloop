import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { CHECK_EMAIL_COOKIE } from "@/lib/auth";
import { emailIsCaptured } from "@/lib/email/send";
import { Brand, Envelope } from "@/components/stationery";
import { copy } from "@/lib/copy";
import { CodeForm } from "./code-form";

export const metadata: Metadata = {
  title: copy.pageTitles.checkEmail,
  robots: { index: false, follow: false },
};

/**
 * Says back the address this browser just typed (a short-lived cookie set by the
 * form), so a typo is obvious. Without it, the general line stands in.
 */
async function SentTo() {
  const email = (await cookies()).get(CHECK_EMAIL_COOKIE)?.value?.slice(0, 254);
  if (!email) {
    return <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{copy.checkEmail.body}</p>;
  }
  return (
    <>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
        {copy.checkEmail.sentTo} <strong className="font-extrabold text-ink [overflow-wrap:anywhere]">{email}</strong>
        {copy.checkEmail.sentToEnd}
      </p>
      <p className="mt-3">
        <Link href="/signin" className="inline-flex min-h-11 items-center text-[14px] font-bold text-accent-ink underline decoration-accent/30 underline-offset-4">
          {copy.checkEmail.differentEmail}
        </Link>
      </p>
    </>
  );
}

/** The code box. It only asks for the address when this browser didn't just give one. */
async function CodeSection() {
  const known = Boolean((await cookies()).get(CHECK_EMAIL_COOKIE)?.value);
  return <CodeForm askEmail={!known} />;
}

export default function CheckEmailPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center px-4 py-10">
      <div className="mb-8 self-start"><Brand /></div>

      <div className="card p-6 text-center">
        <Envelope />
        <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.022em] text-ink">
          {copy.checkEmail.title}
        </h1>
        <Suspense fallback={<p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{copy.checkEmail.body}</p>}>
          <SentTo />
        </Suspense>
        <section aria-labelledby="code-title" className="mt-5 border-t border-dashed border-line pt-5">
          <h2 id="code-title" className="mb-3 text-[17px] font-semibold text-ink">{copy.checkEmail.codeTitle}</h2>
          <Suspense fallback={<CodeForm askEmail={false} />}>
            <CodeSection />
          </Suspense>
        </section>

        {process.env.VERCEL_ENV === "preview" ? (
          <p className="mt-4 rounded-lg border border-line bg-field px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
            {emailIsCaptured()
              ? copy.checkEmail.previewCaptured
              : copy.checkEmail.previewLogged}
            <a href="/dev/outbox" className="font-medium text-accent-ink underline underline-offset-2">
              {copy.checkEmail.openOutbox}
            </a>
            .
          </p>
        ) : null}

        <p className="mt-4 text-[13px] leading-relaxed text-ink-muted">
          {copy.checkEmail.nothingArrived}{" "}
          <Link href="/signin" className="font-medium text-accent-ink underline decoration-accent/30 underline-offset-4">
            {copy.checkEmail.tryAgain}
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
