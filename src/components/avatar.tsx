/**
 * A person's mark: their photo when they have set one for this loop, the first
 * letter of their name otherwise. The name is always printed next to it, so the
 * picture is decoration and stays out of the accessibility tree.
 */
export function Avatar({
  name,
  photoUrl,
  className = "",
}: {
  name: string;
  photoUrl?: string | null;
  className?: string;
}) {
  return (
    <span className={`avatar ${className}`.trim()} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- Uploaded photos live on local URLs in development and Blob in production. */}
      {photoUrl ? <img src={photoUrl} alt="" loading="lazy" /> : name.charAt(0)}
    </span>
  );
}
