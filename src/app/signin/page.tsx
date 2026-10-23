import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { SignInForm } from "./signin-form";
import { Brand, Tape } from "@/components/stationery";

export const instant = false;

export default async function SignInPage() {
  if (await currentUser()) redirect("/you");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center px-4 py-10">
      <div className="mb-8 self-start"><Brand /></div>

      <div className="card p-6 pt-8">
        <Tape tone="dots" position="center" />
        <p className="eyebrow">Hello again,</p>
        <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.022em] text-ink">
          Sign in
        </h1>
        <p className="mb-5 mt-1.5 text-[15px] leading-relaxed text-ink-soft">
          For the person who runs the loop.
        </p>
        <SignInForm />
      </div>

      <p className="mt-6 px-1 text-[13px] leading-relaxed text-ink-muted">
        Answering questions? You never sign in — the link in your email is enough.
      </p>
    </main>
  );
}
