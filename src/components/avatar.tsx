import { isCharmKey, isFrameKey, stickerSrc } from "@/lib/stickers";

/**
 * A person's mark: their photo when they have set one for this loop, the first
 * letter of their name otherwise, in whatever frame they picked. The name is always
 * printed next to it, so the picture is decoration and stays out of the accessibility tree.
 */
export function Avatar({
  name,
  photoUrl,
  frame,
  className = "",
  eager = false,
}: {
  name: string;
  photoUrl?: string | null;
  frame?: string | null;
  className?: string;
  /** Load now rather than on scroll: a printed page has no scrolling to wait for. */
  eager?: boolean;
}) {
  return (
    <span className={`avatar ${className}`.trim()} data-frame={isFrameKey(frame) ? frame : undefined} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- Uploaded photos live on local URLs in development and Blob in production. */}
      {photoUrl ? <img src={photoUrl} alt="" loading={eager ? "eager" : "lazy"} /> : name.charAt(0)}
    </span>
  );
}

/** The sticker someone keeps beside their name. Decoration: the name says who it is. */
export function NameCharm({ charm, eager = false }: { charm?: string | null; eager?: boolean }) {
  if (!isCharmKey(charm)) return null;
  // eslint-disable-next-line @next/next/no-img-element -- A tiny static drawing; there is nothing for the image optimiser to do.
  return <img src={stickerSrc(charm)} alt="" width={20} height={20} loading={eager ? "eager" : "lazy"} className="name-charm" />;
}
