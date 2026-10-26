"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * The last resort: the root layout itself failed, so this file replaces it and
 * owns <html>, the styles, and the theme. Keep it dependency-free — inline CSS
 * only, because globals.css is not guaranteed to load here.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <title>Something went wrong · Friendloop</title>
        <style>{`
          :root { color-scheme: light dark; }
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            padding: 24px;
            background: #fff3f5;
            color: #241a20;
            font-family: ui-rounded, "Nunito", system-ui, -apple-system, sans-serif;
            line-height: 1.55;
          }
          .card {
            width: 100%;
            max-width: 480px;
            background: #fff;
            border: 1px solid #ecd6da;
            border-radius: 18px;
            padding: 28px;
            box-shadow: 0 10px 30px rgb(36 26 32 / 8%);
          }
          h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.15; letter-spacing: -0.02em; }
          p { margin: 0; color: #5f4f56; }
          .actions { margin-top: 20px; display: flex; gap: 12px; flex-wrap: wrap; }
          button, a {
            font: inherit;
            font-weight: 700;
            border-radius: 999px;
            padding: 10px 18px;
            text-decoration: none;
            cursor: pointer;
          }
          button { border: 0; background: #2f6fe4; color: #fff; }
          a { border: 1px solid #d9c2c7; color: #241a20; }
          @media (prefers-color-scheme: dark) {
            body { background: #241a20; color: #fdf2f4; }
            .card { background: #2f232a; border-color: #4a3840; box-shadow: none; }
            p { color: #d9c8cd; }
            a { border-color: #5a434b; color: #fdf2f4; }
          }
        `}</style>
        <div className="card">
          <h1>Something went wrong</h1>
          <p>Nothing you wrote was lost. Try again, or head back to the start.</p>
          <div className="actions">
            <button type="button" onClick={() => retry()}>
              Try again
            </button>
            <Link href="/">Back to Friendloop</Link>
          </div>
        </div>
      </body>
    </html>
  );
}
