import { LoopTabContent } from "../tab-content";

export default async function MembersPage({ searchParams }: {
  searchParams: Promise<{ invited?: string; resent?: string; removed?: string; transferred?: string }>;
}) {
  const notices = await searchParams;
  return <LoopTabContent tab="members" notices={notices} />;
}
