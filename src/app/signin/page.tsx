import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { SignInForm } from "./signin-form";

export const instant = false;

export default async function SignInPage() {
  if (await currentUser()) redirect("/you");

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
