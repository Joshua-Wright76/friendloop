import { LoopTabContent } from "../tab-content";

export default async function QuestionsPage({ searchParams }: {
  searchParams: Promise<{ added?: string; archived?: string; rotation?: string }>;
}) {
  const notices = await searchParams;
  return <LoopTabContent tab="questions" notices={notices} />;
}
