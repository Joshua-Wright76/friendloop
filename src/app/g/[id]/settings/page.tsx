import type { Metadata } from "next";
import { copy } from "@/lib/copy";
import { LoopTabContent } from "../tab-content";

export const metadata: Metadata = { title: copy.pageTitles.settings };

export default async function SettingsPage({ searchParams }: {
  searchParams: Promise<{ saved?: string; error?: string; shares?: string; stationery?: string }>;
}) {
  const notices = await searchParams;
  return <LoopTabContent tab="settings" notices={notices} />;
}
