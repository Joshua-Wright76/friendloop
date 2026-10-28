import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { QUESTION_PACKS } from "@/lib/question-packs";
import { NewLoopForm } from "./new-loop-form";
import { Brand } from "@/components/stationery";
import { copy } from "@/lib/copy";

export const instant = false;

export default async function NewLoopPage() {
  const user = await currentUser();
  if (!user) redirect("/signin");

  return (
    <main className="mx-auto w-full max-w-[760px] px-4 pb-10 pt-5 sm:px-6">
      <header className="stitched mb-8 flex items-center justify-between gap-3 border-b pb-4">
        <Brand href={null} />
        <Link href="/you" className="text-[13px] font-bold text-ink-soft hover:text-ink">← {copy.common.yourLoops}</Link>
      </header>

      <NewLoopForm packs={QUESTION_PACKS} />
    </main>
  );
}
