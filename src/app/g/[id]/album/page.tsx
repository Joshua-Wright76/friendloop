import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { AlbumBody } from "@/components/album-body";
import { loadAlbum } from "@/lib/album";
import { parseAlbumFilters } from "@/lib/album-query";
import { copy } from "@/lib/copy";
import { viewerFor } from "@/lib/permissions";
import { db } from "@/db";
import { groups } from "@/db/schema";
import { AlbumHeader, AlbumLoading } from "./album-header";

export const metadata: Metadata = { title: copy.pageTitles.album };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function AlbumPage(props: Props) {
  return (
    <main className="loop-page mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6 lg:max-w-[1040px]">
      <AlbumHeader />
      {/* The photos are read fresh on every visit; the header and tabs do not wait for them. */}
      <Suspense fallback={<AlbumLoading />}>
        <Album {...props} />
      </Suspense>
    </main>
  );
}

async function Album({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const viewer = await viewerFor(id);
  if (!viewer) notFound();

  const filters = parseAlbumFilters(query);
  const [view, [group]] = await Promise.all([
    loadAlbum({
      groupId: id,
      viewerMembershipId: viewer.membership.id,
      viewerIsAdmin: viewer.membership.access !== "member",
      filters,
    }),
    db.select({ timezone: groups.timezone }).from(groups).where(eq(groups.id, id)).limit(1),
  ]);

  return <AlbumBody view={view} filters={filters} base={`/g/${id}/album`} token={null} timezone={group.timezone} />;
}
