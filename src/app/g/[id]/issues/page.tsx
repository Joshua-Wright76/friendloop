import { Suspense } from "react";
import type { Metadata } from "next";
import { copy } from "@/lib/copy";
import LoopLoading from "../loading";
import { LoopTabContent } from "../tab-content";

export const metadata: Metadata = { title: copy.pageTitles.rounds };

// The "who answered" filter reads `?member=` in the browser against the loop's own
// data, so this tab, like the others, switches without asking the server.
export default function IssuesPage() {
  return (
    <Suspense fallback={<LoopLoading />}>
      <LoopTabContent tab="issues" />
    </Suspense>
  );
}
