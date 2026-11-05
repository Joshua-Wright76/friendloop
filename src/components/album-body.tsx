import Link from "next/link";
import { AlbumGallery } from "@/components/album-gallery";
import { AutoPicker } from "@/components/auto-picker";
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
      {/* Keyed on the filters: a soft navigation (Clear filters, Back) must reset the fields, which are otherwise uncontrolled. */}
      <details className="card filter-fold mt-4 px-4" open={filtered ? true : undefined}>
        <summary>
          <span className="numeric" role="status">
            {view.total === 0
              ? copy.album.filterSummary
              : view.hasMore
                ? text(copy.album.count, { shown: view.shown, total: view.total })
                : view.total === 1
                  ? copy.album.countOne
                  : text(copy.album.countAll, { total: view.total })}
          </span>
          <span className="link">{copy.album.filterSummary}</span>
        </summary>
      <form key={`${filters.member ?? ""}|${filters.q}`} method="get" action={base} role="search" aria-label={copy.album.filtersLabel} className="pb-3">
        {token ? <input type="hidden" name="m" value={token} /> : null}
        <div className="album-filters">
          <label className="block min-w-0 text-[13px] font-bold text-ink-soft">
            <span className="sr-only">{copy.album.searchLabel}</span>
            <span className="flex gap-2">
              <input
                type="search"
                name="q"
                defaultValue={filters.q}
                maxLength={80}
                placeholder={copy.album.searchPlaceholder}
                className="field h-[46px] min-w-0 flex-1 py-0"
              />
              <button type="submit" className="btn btn-quiet flex-none px-4 text-[14px]">{copy.album.apply}</button>
            </span>
          </label>
          <div className="filter-line">
            <span className="text-[14px] font-bold text-ink-soft">{copy.album.memberLabel}</span>
            <AutoPicker
              name="member"
              defaultValue={filters.member ?? ""}
              ariaLabel={copy.album.memberLabel}
              options={[{ value: "", label: copy.album.everyone }, ...view.people.map((person) => ({ value: person.id, label: person.name }))]}
            />
          </div>
        </div>
        {filtered ? <p className="m-0 mt-1"><Link href={albumHref({ base, token })} className="link link--quiet">{copy.album.clear}</Link></p> : null}
      </form>
      </details>

      {view.total === 0 ? (
        <p className="card mt-6 p-5 text-[15px] leading-relaxed text-ink-soft" role="status">
          {filtered ? copy.album.emptyFiltered : copy.album.empty}
        </p>
      ) : (
        <>
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
