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
          /* Gingham Picnic tokens, copied from globals.css so this page still
             looks like Friendloop when the stylesheet never arrived. */
          :root {
            color-scheme: light dark;
            --page: #fff3f5; --check: rgb(236 118 148 / 0.15); --card: #fffdfa;
            --line: #f1dae0; --line-strong: #e4bcc6; --ink: #3d2a30; --ink-soft: #674d55;
            --accent: #cc3456; --accent-deep: #9e2440; --on-accent: #ffffff;
          }
          @media (prefers-color-scheme: dark) {
            :root {
              --page: #241a20; --check: rgb(255 140 170 / 0.07); --card: #30242a;
              --line: #46343c; --line-strong: #5c4650; --ink: #f8eaee; --ink-soft: #dbc2c9;
              --accent: #ff8ba4; --accent-deep: #c45a74; --on-accent: #2a1219;
            }
          }
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            padding: 24px 16px;
            box-sizing: border-box;
            background-color: var(--page);
            background-image:
              linear-gradient(90deg, var(--check) 50%, transparent 50%),
              linear-gradient(var(--check) 50%, transparent 50%);
            background-size: 32px 32px;
            color: var(--ink);
            font-family: ui-rounded, "Nunito", system-ui, -apple-system, sans-serif;
            line-height: 1.55;
          }
          .card {
            width: 100%;
            max-width: 480px;
            box-sizing: border-box;
            background: var(--card);
            border: 1px solid var(--line);
            border-radius: 6px;
            padding: 28px 24px 24px;
          }
          h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.15; }
          p { margin: 0; color: var(--ink-soft); font-size: 15px; }
          .actions { margin-top: 20px; display: flex; gap: 12px; flex-wrap: wrap; }
          button, a {
            font: inherit;
            font-weight: 800;
            font-size: 15px;
            min-height: 44px;
            display: inline-flex;
            align-items: center;
            border-radius: 999px;
            padding: 0 20px;
            text-decoration: none;
            cursor: pointer;
          }
          button { border: 0; background: var(--accent); color: var(--on-accent); box-shadow: 0 3px 0 var(--accent-deep); }
          a { border: 0; background: var(--card); color: var(--ink-soft); box-shadow: inset 0 0 0 1.5px var(--line-strong); }
          button:focus-visible, a:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
        `}</style>
        <div className="card">
          <h1>Something went wrong</h1>
          <p>Check your connection, then try again. Anything already saved is safe.</p>
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
