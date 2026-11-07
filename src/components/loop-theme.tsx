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
