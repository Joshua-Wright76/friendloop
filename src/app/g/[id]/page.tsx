import { LoopTabContent } from "./tab-content";

export default async function LoopPage({ searchParams }: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const { welcome } = await searchParams;
  return <LoopTabContent tab="overview" welcome={welcome} />;
}
