import { cache, Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { CHECK_EMAIL_COOKIE } from "@/lib/auth";
import { JOIN_CHECK_COOKIE, loopForInvite } from "@/lib/invite-link";
import { emailIsCaptured } from "@/lib/email/send";
import { Brand, Envelope } from "@/components/stationery";
import { copy, text } from "@/lib/copy";
import { CodeForm } from "./code-form";
import { ResendLink } from "./resend-link";

export const metadata: Metadata = {
  title: copy.pageTitles.checkEmail,
  robots: { index: false, follow: false },
};

/**
 * The heading and the line under it. With the address this browser just typed (a
 * short-lived cookie set by the form) it says back where the email went, so a typo
 * is obvious, and for someone who came from an invite link it names the loop that
 * is waiting. Without an address it claims nothing was sent: the page may have been
 * opened cold, from a bookmark or a home-screen app.
 */
const askedFor = cache(async () => {
  const jar = await cookies();
  const email = jar.get(CHECK_EMAIL_COOKIE)?.value?.slice(0, 254);
  const joinToken = jar.get(JOIN_CHECK_COOKIE)?.value;
  const loop = email && joinToken ? await loopForInvite(joinToken) : null;
  return { email, joinToken, loop };
});

async function Lead() {
  const { email, joinToken, loop } = await askedFor();

  const heading = "text-[24px] font-semibold leading-tight tracking-[-0.022em] text-ink";
  const line = "mt-2 text-[15px] leading-relaxed text-ink-soft";
  if (!email) {
    return (
      <>
        <h1 className={heading}>{copy.checkEmail.coldTitle}</h1>
        <p className={line}>{copy.checkEmail.coldBody}</p>
      </>
    );
  }
  return (
    <>
      <h1 className={`${heading} wrap-any`}>
        {loop ? text(copy.checkEmail.joinTitle, { groupName: loop.groupName }) : copy.checkEmail.title}
      </h1>
      {loop ? (
        <p className={line}>
          {copy.checkEmail.sentTo} <strong className="font-extrabold text-ink [overflow-wrap:anywhere]">{email}</strong>
          {". "}{copy.checkEmail.joinNext}
        </p>
      ) : (
        <p className={line}>
          {copy.checkEmail.sentTo} <strong className="font-extrabold text-ink [overflow-wrap:anywhere]">{email}</strong>
          {copy.checkEmail.sentToEnd}
        </p>
      )}
      <ResendLink />
      <p>
        <Link
          href={loop && joinToken ? `/join/${encodeURIComponent(joinToken)}` : "/signin"}
          className="inline-flex min-h-11 items-center text-[14px] font-bold text-accent-ink underline decoration-accent/30 underline-offset-4"
        >
          {copy.checkEmail.differentEmail}
        </Link>
      </p>
    </>
  );
}

/** "Nothing arrived? Try again", or, when nothing was asked for here, the way back to sign in. */
async function Footnote() {
  const { email, joinToken, loop } = await askedFor();
  const known = Boolean(email);
  // Someone who came from an invite goes back to the invite, not to a plain sign-in that forgets it.
  const back = loop && joinToken ? `/join/${encodeURIComponent(joinToken)}` : "/signin";
  const link = "inline-flex min-h-11 items-center font-medium text-accent-ink underline decoration-accent/30 underline-offset-4";
  return known ? (
    <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
      {copy.checkEmail.nothingArrived}{" "}
      <Link href={back} className={link}>{copy.checkEmail.tryAgain}</Link>.
    </p>
  ) : (
    <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">
      <Link href="/signin" className={link}>{copy.checkEmail.coldSignIn}</Link>
    </p>
  );
}

/** The code box. It only asks for the address when this browser didn't just give one. */
async function CodeSection() {
  const { email, loop } = await askedFor();
  return <CodeForm askEmail={!email} joining={Boolean(loop)} />;
}

export default function CheckEmailPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center px-4 py-10">
      <div className="mb-8 self-start"><Brand /></div>

      <div className="card p-6 text-center">
        <Envelope />
        <Suspense fallback={<div aria-hidden className="h-[96px]" />}>
          <Lead />
        </Suspense>
        <section aria-labelledby="code-title" className="mt-5 border-t border-dashed border-line pt-5">
          <h2 id="code-title" className="mb-3 text-[17px] font-semibold text-ink">{copy.checkEmail.codeTitle}</h2>
          {/* A still placeholder, not a form: a box typed into before the address field arrived would be lost. */}
          <Suspense fallback={<div aria-hidden className="h-[150px]" />}>
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

        <Suspense fallback={null}>
          <Footnote />
        </Suspense>
      </div>
    </main>
  );
}
