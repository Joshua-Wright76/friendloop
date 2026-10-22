const FALLBACK = "http://localhost:3000";

export function appUrl(): string {
  // A preview must link to itself, never to production: every email a dev loop
  // sends would otherwise point at the live site.
  const raw =
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

export function signInUrl(token: string): string {
  return url(`/signin/confirm?token=${encodeURIComponent(token)}`);
}
