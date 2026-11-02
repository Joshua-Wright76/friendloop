import Link from "next/link";
import { AlbumGallery } from "@/components/album-gallery";
import { albumHref, type AlbumFilters } from "@/lib/album-query";
import type { AlbumView } from "@/lib/album";
import { copy, text } from "@/lib/copy";
import { formatDate } from "@/lib/format";
import { issueTitle } from "@/lib/issue-name";

/**
 * Filters, count, gallery and "show more" for one loop's album. Everything is a
 * plain GET: the form and the links rebuild the URL, so a filtered album is a
 * link and the page needs no script until someone opens a photo.
 */
export function AlbumBody({
  view,
  filters,
  base,
  token,
  timezone,
}: {
  view: AlbumView;
  filters: AlbumFilters;
  /** The path this album is served from, without a query. */
  base: string;
  /** A link-holder's reply token; carried through every link so they stay recognised. */
  token: string | null;
  timezone: string;
}) {
  const filtered = Boolean(filters.member || filters.q);
  const groups = view.groups.map((group) => ({
    issueId: group.issueId,
    title: issueTitle(copy.album.round, group.number, group.name),
    dateLabel: text(copy.album.deliveredOn, { date: formatDate(group.deliveredAt, timezone) }),
    items: group.items,
  }));

  return (
    <>
      <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">{copy.album.intro}</p>

      {/* Keyed on the filters: a soft navigation (Clear filters, Back) must reset the fields, which are otherwise uncontrolled. */}
      <form key={`${filters.member ?? ""}|${filters.q}`} method="get" action={base} role="search" aria-label={copy.album.filtersLabel} className="card mt-5 p-4">
        {token ? <input type="hidden" name="m" value={token} /> : null}
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-44 flex-[2] text-[13px] font-bold text-ink-soft">
            {copy.album.searchLabel}
            <input
              type="search"
              name="q"
              defaultValue={filters.q}
              maxLength={80}
              placeholder={copy.album.searchPlaceholder}
              className="field mt-1 h-[46px] py-0"
            />
          </label>
          <label className="block min-w-36 flex-1 text-[13px] font-bold text-ink-soft">
            {copy.album.memberLabel}
            <select name="member" defaultValue={filters.member ?? ""} className="field mt-1 h-[46px] py-0">
              <option value="">{copy.album.everyone}</option>
              {view.people.map((person) => (
                <option key={person.id} value={person.id}>{person.name}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-primary">{copy.album.apply}</button>
        </div>
        {filtered ? (
          <p className="m-0 mt-3">
            <Link href={albumHref({ base, token })} className="inline-flex min-h-11 items-center text-[14px] font-bold text-ink-soft underline underline-offset-4">
              {copy.album.clear}
            </Link>
          </p>
        ) : null}
      </form>

      {view.total === 0 ? (
        <p className="card mt-6 p-5 text-[15px] leading-relaxed text-ink-soft" role="status">
          {filtered ? copy.album.emptyFiltered : copy.album.empty}
        </p>
      ) : (
        <>
          <p className="mt-5 text-[13px] font-bold text-ink-muted numeric" role="status">
            {view.hasMore
              ? text(copy.album.count, { shown: view.shown, total: view.total })
              : view.total === 1
                ? copy.album.countOne
                : text(copy.album.countAll, { total: view.total })}
          </p>
          <AlbumGallery groups={groups} />
          {view.hasMore ? (
            <p className="mt-8 text-center">
              <Link
                href={albumHref({ base, token, member: filters.member, q: filters.q, pages: filters.pages + 1 })}
                className="btn btn-quiet"
                scroll={false}
              >
                {copy.album.showMore}
              </Link>
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
