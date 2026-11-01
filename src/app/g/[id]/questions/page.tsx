import { LoopTabContent } from "../tab-content";

export default async function QuestionsPage({ searchParams }: {
  searchParams: Promise<{ added?: string; archived?: string; rotation?: string; fromPacks?: string; suggestion?: string; section?: string; poll?: string }>;
}) {
  const notices = await searchParams;
  return <LoopTabContent tab="questions" notices={notices} />;
}
