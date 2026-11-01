import { LoopTabContent } from "../tab-content";

export default async function SettingsPage({ searchParams }: {
  searchParams: Promise<{ saved?: string; error?: string; shares?: string; stationery?: string }>;
}) {
  const notices = await searchParams;
  return <LoopTabContent tab="settings" notices={notices} />;
}
