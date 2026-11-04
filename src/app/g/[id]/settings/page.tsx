import { Suspense } from "react";
import type { Metadata } from "next";
import { copy } from "@/lib/copy";
import LoopLoading from "../loading";
import { LoopTabContent } from "../tab-content";

export const metadata: Metadata = { title: copy.pageTitles.settings };

export default function SettingsPage() {
  return (
    <Suspense fallback={<LoopLoading />}>
      <LoopTabContent tab="settings" />
    </Suspense>
  );
}
