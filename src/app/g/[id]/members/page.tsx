import type { Metadata } from "next";
import { copy } from "@/lib/copy";
import { LoopTabContent } from "../tab-content";

export const metadata: Metadata = { title: copy.pageTitles.members };

export default async function MembersPage({ searchParams }: {
  searchParams: Promise<{ invited?: string; resent?: string; removed?: string; transferred?: string; transferError?: string }>;
}) {
  const notices = await searchParams;
  return <LoopTabContent tab="members" notices={notices} />;
}
