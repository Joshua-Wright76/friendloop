import type { Metadata } from "next";
import { copy } from "@/lib/copy";
import { LoopTabContent } from "../tab-content";

export const metadata: Metadata = { title: copy.pageTitles.questions };

export default async function QuestionsPage({ searchParams }: {
  searchParams: Promise<{ added?: string; archived?: string; skip?: string; rotation?: string; fromPacks?: string; suggestion?: string; section?: string; poll?: string; event?: string }>;
}) {
  const notices = await searchParams;
  return <LoopTabContent tab="questions" notices={notices} />;
}
