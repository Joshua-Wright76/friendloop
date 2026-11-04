import { Suspense } from "react";
import Link from "next/link";
import { Brand, Cherries, Tape } from "@/components/stationery";
import { currentUser } from "@/lib/auth";
import { LegalLinks } from "@/components/legal-page";
import { copy } from "@/lib/copy";

const HEADER_LINK = "text-[14px] font-bold text-ink-soft underline decoration-dashed underline-offset-4 hover:text-ink";

/** A hand-drawn heart, in place of a "<3" that Gaegu draws as an angle bracket. */
function HeartDoodle() {
  return (
    <svg viewBox="0 0 40 36" aria-hidden="true" className="home-heart">
      <path
        d="M20 32C9 24.5 3.5 18 4.2 11.6 4.8 6.4 9.4 3.4 13.8 4.6c2.7.7 4.7 2.6 6.2 5.2 1.5-2.7 3.6-4.6 6.4-5.3 4.5-1.1 9 2 9.4 7.2.5 6.3-5.2 12.7-15.8 20.3Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Reads the session, so it streams in behind its own boundary and the rest of the page stays static. */
async function AccountLink() {
  const user = await currentUser();
  return user ? (
    <Link href="/you" className={HEADER_LINK}>{copy.home.yourLoops}</Link>
  ) : (
    <Link href="/signin" className={HEADER_LINK}>{copy.home.signIn}</Link>
  );
}

/** Someone already signed in goes straight to the wizard rather than through a sign-in redirect. */
async function StartLink() {
  const user = await currentUser();
  return <Link href={user ? "/g/new" : "/signin"} className="btn btn-primary">{copy.home.startLoop}</Link>;
}

export default function Home() {
  const accentWords = copy.home.titleAccent.split(" ");
  const lastWord = accentWords.pop();

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-[880px] flex-col px-5 py-5 sm:min-h-dvh sm:px-8 sm:py-8">
      <header className="flex items-center justify-between gap-4">
        <Brand />
        <div className="flex items-center gap-4">
          {process.env.NODE_ENV === "development" && !process.env.VERCEL_ENV ? (
            <Link href="/dev/ui" className={HEADER_LINK}>
              {copy.devUi.title}
            </Link>
          ) : null}
          <Suspense fallback={<Link href="/signin" className={HEADER_LINK}>{copy.home.signIn}</Link>}>
            <AccountLink />
          </Suspense>
        </div>
      </header>

      <div className="flex flex-1 items-center py-8 sm:py-16">
        <section className="card home-card ride-in w-full">
          <Tape tone="dots" position="left" />
          <Cherries className="home-doodle" />
          <h1 className="home-title font-bold text-ink">
            {copy.home.titleStart}{" "}
            <em>
              <span aria-hidden="true">
                {accentWords.join(" ")}{" "}
                {/* The heart never wraps onto a line of its own. */}
                <span className="whitespace-nowrap">{lastWord}{" "}<HeartDoodle /></span>
              </span>
              <span className="sr-only">{copy.home.titleAccentSpoken}</span>
            </em>
          </h1>
          <p className="mt-6 max-w-[52ch] text-[17px] leading-relaxed text-ink-soft">
            {copy.home.description}
          </p>

          <h2 className="home-how-title mt-8 text-ink">{copy.home.howTitle}</h2>
          <ol className="home-steps mt-3">
            {copy.home.steps.map((step, index) => (
              <li key={step.title} className="home-step">
                <span className="question-number" aria-hidden="true">{index + 1}</span>
                <span>
                  <span className="block font-extrabold text-ink">{step.title}</span>
                  <span className="mt-0.5 block text-[15px] leading-relaxed text-ink-soft">{step.body}</span>
                </span>
              </li>
            ))}
          </ol>

          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Suspense fallback={<Link href="/signin" className="btn btn-primary">{copy.home.startLoop}</Link>}>
              <StartLink />
            </Suspense>
            <p className="m-0 text-[14px] font-bold leading-snug text-ink-soft">{copy.home.noAccount}</p>
          </div>
        </section>
      </div>

      <footer className="pb-2">
        <LegalLinks />
      </footer>
    </main>
  );
}
