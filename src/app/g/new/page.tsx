import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { currentUser } from "@/lib/auth";
import { QUESTION_PACKS } from "@/lib/question-packs";
import { starterQuestions } from "@/lib/starter-questions";
import { e2eSeamsAllowed } from "@/lib/e2e";
import { NewLoopForm } from "./new-loop-form";
import { Brand } from "@/components/stationery";
import { copy } from "@/lib/copy";

export const instant = false;

export const metadata: Metadata = {
  title: copy.pageTitles.newLoop,
  robots: { index: false, follow: false },
};

export default async function NewLoopPage() {
  const user = await currentUser();
  if (!user) redirect("/signin");
  // Drawn per visit, so two loops rarely start on the same questions. The suite gets the library's order.
  await connection();
  const starter = starterQuestions(QUESTION_PACKS, e2eSeamsAllowed() ? null : Math.random);

  return (
    <main className="mx-auto w-full max-w-[680px] px-4 pb-6 pt-4 sm:px-6">
      <div className="wizard-sheet">
        <header className="stitched mb-3 flex items-center justify-between gap-3 border-b pb-2">
          <Brand href={null} />
          <Link href="/you" className="link link--quiet">{copy.common.yourLoops}</Link>
        </header>

        <NewLoopForm packs={QUESTION_PACKS} starter={starter} userId={user.id} />
      </div>
    </main>
  );
}
