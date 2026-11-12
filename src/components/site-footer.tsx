import Link from "next/link";
import { FeedbackButton } from "@/components/feedback-button";
import { ThemeSwitch } from "@/components/theme-switch";
import { copy } from "@/lib/copy";

// A painted dot (see .site-chrome-dot), not a "·" glyph: axe cannot measure contrast on one-character text, and a dot says nothing a screen reader needs.
const dot = <span aria-hidden="true" className="site-chrome-dot" />;

/**
 * The one footer every page ends with: a quiet line of text links (the brand,
 * Privacy, Terms, Send feedback, Dark mode) on a paper backdrop, in the page's
 * flow and never floating. Styles are `.site-chrome` in globals.css.
 */
export function SiteFooter() {
  return (
    <footer className="site-chrome">
      <div className="site-chrome-row">
        <Link href="/" className="site-chrome-link">{copy.common.brand}</Link>
        {dot}
        <Link href="/privacy" className="site-chrome-link">{copy.legal.privacyLink}</Link>
        {dot}
        <Link href="/terms" className="site-chrome-link">{copy.legal.termsLink}</Link>
        {dot}
        <FeedbackButton />
        {dot}
        <ThemeSwitch />
      </div>
    </footer>
  );
}
