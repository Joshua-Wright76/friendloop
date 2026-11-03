import Link from "next/link";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { groups } from "@/db/schema";
import { AlbumBody } from "@/components/album-body";
import { LoopBanner, LoopTheme } from "@/components/loop-theme";
import { Cherries } from "@/components/stationery";
import { loadAlbum } from "@/lib/album";
import { parseAlbumFilters } from "@/lib/album-query";
import { currentUser } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { membershipForViewer } from "@/lib/issue-view";

export const instant = false;

export const metadata: Metadata = {
  title: copy.pageTitles.album,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The Album for people who read the loop from their inbox: the reply token that
 * opens `/i/<id>?m=` opens this too. Share links have no equivalent — a stranger
 * with a share URL reads one round, never the archive.
 */
export default async function TokenAlbumPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();

  const token = typeof query.m === "string" && query.m ? query.m : null;
  const user = await currentUser();
  const membership = await membershipForViewer({ groupId: id, userId: user?.id ?? null, token });
  if (!membership) notFound();

  const [group] = await db.select().from(groups).where(eq(groups.id, id)).limit(1);
  const filters = parseAlbumFilters(query);
  const view = await loadAlbum({
    groupId: id,
    viewerMembershipId: membership.id,
    viewerIsAdmin: membership.access !== "member",
    filters,
    token,
  });

  return (
    <main className="mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6">
      <LoopTheme preset={group.themePreset} accent={group.themeAccent} />
      <LoopBanner url={group.headerImageUrl} className="mb-5" />
      <header className="stitched mb-8 flex items-center justify-between gap-3 border-b pb-4">
        <span className="flex min-w-0 items-center gap-2 font-display text-[23px] font-bold text-ink">
          <Cherries className="h-7 w-7 flex-none" /><span className="truncate">{group.name}</span>
        </span>
      </header>
      <p className="eyebrow">{copy.album.eyebrow}</p>
      <h1 className="mt-1 text-ink">{copy.album.title}</h1>
      <AlbumBody view={view} filters={filters} base={`/album/${id}`} token={token} timezone={group.timezone} />
      <p className="mt-8 text-center text-[13px] text-ink-muted">
        <Link href="/" className="underline decoration-line-strong underline-offset-4">{copy.common.brand}</Link>
      </p>
    </main>
  );
}
