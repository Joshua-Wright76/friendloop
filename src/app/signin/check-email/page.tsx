import Link from "next/link";
import { emailIsCaptured } from "@/lib/email/send";

export default function CheckEmailPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center px-4 py-10">
      <Link
        href="/"
        className="mb-8 flex items-center gap-2 self-start text-[15px] font-semibold tracking-[-0.01em] text-ink"
      >
        <span className="grid h-6 w-6 place-items-center rounded-[7px] bg-accent text-[13px] font-bold text-white">
          f
        </span>
        Friendloop
      </Link>

      <div className="card p-6">
        <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.022em] text-ink">
          Check your inbox
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
          There&apos;s a sign-in link on its way. It works once and expires in 15 minutes.
        </p>
        {process.env.VERCEL_ENV === "preview" ? (
          <p className="mt-4 rounded-lg border border-line bg-field px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
            {emailIsCaptured()
              ? "This preview captures email instead of sending it — "
              : "Every preview email is kept as a copy — "}
            <a href="/dev/outbox" className="font-medium text-accent underline underline-offset-2">
              open the dev outbox
            </a>
            .
          </p>
        ) : null}

        <p className="mt-4 text-[13px] leading-relaxed text-ink-muted">
          Nothing arrived? Check spam, then{" "}
          <Link href="/signin" className="font-medium text-accent underline decoration-accent/30 underline-offset-4">
            try again
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
