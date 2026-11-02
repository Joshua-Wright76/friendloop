import { resolveTheme, themeCss } from "@/lib/theme";

/**
 * A loop's stationery, layered over Gingham Picnic. Renders nothing for a loop
 * that never chose one, so those loops stay exactly as they were. The CSS comes
 * from `themeCss`, which only emits colours it derived from validated input.
 */
export function LoopTheme({ preset, accent }: { preset: string | null; accent: string | null }) {
  const css = themeCss(resolveTheme({ preset, accent }));
  return css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null;
}

/** The owner's header picture. Decorative: the loop's name is the heading. */
export function LoopBanner({ url, className = "" }: { url: string | null; className?: string }) {
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element -- Uploaded pictures live on local URLs in development and Blob in production.
  return <img src={url} alt="" className={`loop-banner ${className}`.trim()} />;
}
