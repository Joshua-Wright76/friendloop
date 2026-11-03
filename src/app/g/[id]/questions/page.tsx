import { Suspense } from "react";
import type { Metadata } from "next";
import { copy } from "@/lib/copy";
import LoopLoading from "../loading";
import { LoopTabContent } from "../tab-content";

export const metadata: Metadata = { title: copy.pageTitles.questions };

export default function QuestionsPage() {
  return (
    <Suspense fallback={<LoopLoading />}>
      <LoopTabContent tab="questions" />
    </Suspense>
  );
}
