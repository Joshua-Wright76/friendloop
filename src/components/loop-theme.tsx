import { Cherries } from "@/components/stationery";
import { stationeryCss, stationeryOf, type StationeryColumns } from "@/lib/stationery";

/**
 * A loop's stationery, layered over Gingham Picnic. Renders nothing for a loop
 * that never chose one, so those loops stay exactly as they were. The CSS comes
 * from `stationeryCss`, which only emits values from its own tables and colours it
 * derived from validated input.
 */
export function LoopTheme({ group }: { group: StationeryColumns }) {
  const css = stationeryCss(stationeryOf(group));
  return css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null;
}

/** The compact form of the header picture, for pages where the fold belongs to the words. */
export function LoopSnapshot({ url }: { url: string | null }) {
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element -- Uploaded pictures live on local URLs in development and Blob in production.
  return <span className="snapshot" aria-hidden="true"><img src={url} alt="" /></span>;
}

/** The owner's header picture. Decorative: the loop's name is the heading. */
export function LoopBanner({ url, className = "" }: { url: string | null; className?: string }) {
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element -- Uploaded pictures live on local URLs in development and Blob in production.
  return <img src={url} alt="" className={`loop-banner ${className}`.trim()} />;
}

/**
 * The one header for a loop's standalone pages (join, leave, unsubscribe, suggest):
 * the loop's mascot and name in the display type, as on the reply sheet's top bar,
 * then its banner picture if it has one. The Friendloop brand lives in the footer.
 */
export function LoopPageHeader({ name, imageUrl }: { name: string; imageUrl: string | null }) {
  return (
    <header className="mb-6">
      <p className="flex items-center gap-2 font-display text-[23px] font-bold text-ink">
        <Cherries className="h-7 w-7 flex-none" />
        <span className="wrap-any">{name}</span>
      </p>
      <LoopBanner url={imageUrl} className="mt-3" />
    </header>
  );
}
