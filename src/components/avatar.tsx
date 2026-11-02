/**
 * A person's mark: their photo when they have set one for this loop, the first
 * letter of their name otherwise. The name is always printed next to it, so the
 * picture is decoration and stays out of the accessibility tree.
 */
export function Avatar({
  name,
  photoUrl,
  className = "",
  eager = false,
}: {
  name: string;
  photoUrl?: string | null;
  className?: string;
  /** Load now rather than on scroll: a printed page has no scrolling to wait for. */
  eager?: boolean;
}) {
  return (
    <span className={`avatar ${className}`.trim()} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- Uploaded photos live on local URLs in development and Blob in production. */}
      {photoUrl ? <img src={photoUrl} alt="" loading={eager ? "eager" : "lazy"} /> : name.charAt(0)}
    </span>
  );
}
