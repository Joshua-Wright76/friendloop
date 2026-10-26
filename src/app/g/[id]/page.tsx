import { LoopTabContent } from "./tab-content";

export default async function LoopPage({ searchParams }: {
  searchParams: Promise<{ welcome?: string; nudged?: string }>;
}) {
  const { welcome, nudged } = await searchParams;
  return <LoopTabContent tab="overview" welcome={welcome} nudged={nudged} />;
}
