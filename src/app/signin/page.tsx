import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { SignInForm } from "./signin-form";
import { Brand, Tape } from "@/components/stationery";
import { LegalLinks } from "@/components/legal-page";
import { copy } from "@/lib/copy";

export const instant = false;

export const metadata: Metadata = {
  title: copy.pageTitles.signIn,
  robots: { index: false, follow: false },
};

export default async function SignInPage() {
  if (await currentUser()) redirect("/you");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center px-4 py-10">
      <div className="mb-8 self-start"><Brand /></div>

      <div className="card p-6 pt-8">
        <Tape tone="dots" position="center" />
        <p className="eyebrow">{copy.signIn.eyebrow}</p>
        <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.022em] text-ink">
          {copy.signIn.title}
        </h1>
        <p className="mb-5 mt-1.5 text-[15px] leading-relaxed text-ink-soft">
          {copy.signIn.subtitle}
        </p>
        <SignInForm />
        <p className="mt-3 text-center">
          <Link href="/signin/check-email" className="inline-flex min-h-11 items-center text-[14px] font-bold text-accent-ink underline decoration-accent/30 underline-offset-4">
            {copy.signIn.haveCode}
          </Link>
        </p>
        <p className="mt-5 border-t border-dashed border-line pt-4 text-[14px] leading-relaxed text-ink-soft">
          {copy.signIn.memberHint}
        </p>
      </div>

      <LegalLinks className="mt-6" />
    </main>
  );
}
