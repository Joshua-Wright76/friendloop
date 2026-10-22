import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { bankByGroup } from "@/lib/question-bank";
import { NewLoopForm } from "./new-loop-form";

export const instant = false;

export default async function NewLoopPage() {
  const user = await currentUser();
  if (!user) redirect("/signin");

  return (
    <main className="mx-auto w-full max-w-[560px] px-4 pb-16 pt-5">
      <header className="mb-5">
        <Link href="/you" className="text-[13px] font-medium text-ink-soft hover:text-ink">
          ← Your loops
        </Link>
      </header>

      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">
        New loop
      </h1>
      <p className="mb-6 mt-1.5 text-[15px] leading-relaxed text-ink-soft">
        Pick a few questions. You can change everything later.
      </p>

      <NewLoopForm bank={bankByGroup()} />
    </main>
  );
}
