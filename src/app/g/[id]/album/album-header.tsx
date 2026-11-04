"use client";

import { LoopNav } from "@/components/loop-nav";
import { copy } from "@/lib/copy";
import { useLoopData } from "../loop-data";

/** The album's header comes from data the loop layout already has, so it shows the moment the tab opens. */
export function AlbumHeader() {
  const { group, membership } = useLoopData();
  return (
    <>
      <LoopNav id={group.id} name={group.name} access={membership.access} active="Album" />
      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">{copy.album.title}</h1>
    </>
  );
}

export function AlbumLoading() {
  return (
    <div aria-busy="true">
      <div role="status" className="sr-only">{copy.common.loading}</div>
      <div className="card mt-6 h-40 motion-safe:animate-pulse" />
      <div className="card mt-5 h-28 motion-safe:animate-pulse" />
    </div>
  );
}
