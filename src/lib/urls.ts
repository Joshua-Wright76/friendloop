const FALLBACK = "http://localhost:3000";

export function appUrl(): string {
  // A preview must link to itself, never to production: every email a dev loop
  // sends would otherwise point at the live site.
  // The suite runs one build on several ports, which a build-time value can't say.
  const raw =
    (process.env.E2E === "1" ? process.env.E2E_APP_URL : undefined) ??
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : FALLBACK);
  return raw.replace(/\/$/, "");
}

export function url(path: string): string {
  return `${appUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

export function replyUrl(token: string): string {
  return url(`/r/${token}`);
}

export function issueUrl(id: string, membershipToken?: string): string {
  const suffix = membershipToken ? `?m=${encodeURIComponent(membershipToken)}` : "";
  return url(`/i/${id}${suffix}`);
}

export function shareUrl(token: string): string {
  return url(`/s/${token}`);
}

/** A loop's shareable invite link. */
export function joinUrl(token: string): string {
  return url(`/join/${token}`);
}

export function signInUrl(token: string): string {
  return url(`/signin/confirm?token=${encodeURIComponent(token)}`);
}

/** The page a footer "stop emails" link opens: it confirms before muting. */
export function unsubscribeUrl(token: string): string {
  return url(`/u/${token}`);
}

/** The RFC 8058 one-click endpoint the `List-Unsubscribe` header names. */
export function oneClickUnsubscribeUrl(token: string): string {
  return url(`/api/unsubscribe/${token}`);
}

/**
 * The loop's picture as emails show it. Mail lives forever but a picture can be
 * replaced or removed, so emails never name the stored file: this address always
 * leads to whatever the loop shows now.
 */
export function loopPictureUrl(groupId: string): string {
  return url(`/api/loop/${encodeURIComponent(groupId)}/header-image`);
}
