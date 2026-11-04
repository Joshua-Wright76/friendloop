import { exportFilename, toStream } from "./data-export.ts";

/** A streamed JSON download that no cache or referrer ever keeps. */
export function exportResponse(chunks: AsyncGenerator<string>, subject: string, at: Date): Response {
  return new Response(toStream(chunks), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(subject, at)}"`,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
