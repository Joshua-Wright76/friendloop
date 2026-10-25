import { LoopTabContent } from "../tab-content";

export default async function QuestionsPage({ searchParams }: {
  searchParams: Promise<{ added?: string; archived?: string }>;
}) {
  const notices = await searchParams;
  return <LoopTabContent tab="questions" notices={notices} />;
}
