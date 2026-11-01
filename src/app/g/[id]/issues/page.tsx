import { LoopTabContent } from "../tab-content";

export default async function IssuesPage({ searchParams }: {
  searchParams: Promise<{ opened?: string; named?: string }>;
}) {
  const notices = await searchParams;
  return <LoopTabContent tab="issues" notices={notices} />;
}
