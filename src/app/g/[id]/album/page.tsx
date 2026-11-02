import Link from "next/link";
import { notFound } from "next/navigation";
import { AlbumBody } from "@/components/album-body";
import { LoopNav } from "@/components/loop-nav";
import { loadAlbum } from "@/lib/album";
import { parseAlbumFilters } from "@/lib/album-query";
import { copy, text } from "@/lib/copy";
import { viewerFor } from "@/lib/permissions";
import { db } from "@/db";
import { groups } from "@/db/schema";
import { eq } from "drizzle-orm";

export default async function AlbumPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
    db.select({ name: groups.name, timezone: groups.timezone }).from(groups).where(eq(groups.id, id)).limit(1),
  ]);

  return (
    <main className="mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6">
      <header className="mb-5">
        <Link href={`/g/${id}`} className="text-[13px] font-medium text-ink-soft hover:text-ink">
          {text(copy.album.back, { name: group.name })}
        </Link>
      </header>
      <LoopNav id={id} active="Album" isOwner={viewer.membership.access === "owner"} />
      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">{copy.album.title}</h1>
      <AlbumBody view={view} filters={filters} base={`/g/${id}/album`} token={null} timezone={group.timezone} />
    </main>
  );
}
