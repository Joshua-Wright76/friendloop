import type { Metadata } from "next";
import { copy } from "@/lib/copy";
import { LoopTabContent } from "./tab-content";

export const metadata: Metadata = { title: copy.pageTitles.overview };

export default async function LoopPage({ searchParams }: {
  searchParams: Promise<{ welcome?: string; nudged?: string }>;
}) {
  const { welcome, nudged } = await searchParams;
  return <LoopTabContent tab="overview" welcome={welcome} nudged={nudged} />;
}
