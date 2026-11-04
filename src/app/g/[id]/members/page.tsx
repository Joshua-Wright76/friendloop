import { Suspense } from "react";
import type { Metadata } from "next";
import { copy } from "@/lib/copy";
import LoopLoading from "../loading";
import { LoopTabContent } from "../tab-content";

export const metadata: Metadata = { title: copy.pageTitles.members };

export default function MembersPage() {
  return (
    <Suspense fallback={<LoopLoading />}>
      <LoopTabContent tab="members" />
    </Suspense>
  );
}
