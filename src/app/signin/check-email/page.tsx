import Link from "next/link";
import type { Metadata } from "next";
import { emailIsCaptured } from "@/lib/email/send";
import { Brand, Envelope } from "@/components/stationery";
import { copy } from "@/lib/copy";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function CheckEmailPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center px-4 py-10">
      <div className="mb-8 self-start"><Brand /></div>

      <div className="card p-6 text-center">
        <Envelope />
        <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.022em] text-ink">
          {copy.checkEmail.title}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
          {copy.checkEmail.body}
        </p>
        {process.env.VERCEL_ENV === "preview" ? (
          <p className="mt-4 rounded-lg border border-line bg-field px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
            {emailIsCaptured()
              ? copy.checkEmail.previewCaptured
              : copy.checkEmail.previewLogged}
            <a href="/dev/outbox" className="font-medium text-accent underline underline-offset-2">
              {copy.checkEmail.openOutbox}
            </a>
            .
          </p>
        ) : null}

        <p className="mt-4 text-[13px] leading-relaxed text-ink-muted">
          {copy.checkEmail.nothingArrived}{" "}
          <Link href="/signin" className="font-medium text-accent underline decoration-accent/30 underline-offset-4">
            {copy.checkEmail.tryAgain}
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
