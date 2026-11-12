import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import localFont from "next/font/local";
import { SiteFooter } from "@/components/site-footer";
import { copy } from "@/lib/copy";
import { THEME_COLORS } from "@/lib/theme";
import { appUrl } from "@/lib/urls";
import "./globals.css";

// Not preloaded: a preload races the page's own HTML and code for a phone's
// bandwidth, and text paints in the size-matched fallback until the font arrives.
const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  preload: false,
});

// Gaegu from Google is mostly Korean: 179 faces, several of whose ranges also claim
// plain ASCII, so English text pulled in dozens of Korean files (about 700 KB) and
// their rules filled the render-blocking stylesheet. Only its Latin files ship now.
// Text it lacks (Hangul, say) falls to the next font in --font-display.
const gaegu = localFont({
  variable: "--font-gaegu",
  src: [
    { path: "../assets/fonts/gaegu-latin-400.woff2", weight: "400", style: "normal" },
    { path: "../assets/fonts/gaegu-latin-700.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  preload: false,
  fallback: ["Comic Sans MS", "cursive"],
});

export const metadata: Metadata = {
  // Every page names itself (2.4.2); the template keeps the brand on the end.
  title: { default: copy.common.metadataTitle, template: `%s · ${copy.common.brand}` },
  description: copy.common.metadataDescription,
  applicationName: copy.common.brand,
  appleWebApp: { capable: true, title: copy.common.brand, statusBarStyle: "black-translucent" },
  metadataBase: new URL(appUrl()),
  // Every route inherits this card and the root opengraph-image, private ones
  // included: a shared reply link or round previews as Friendloop and nothing
  // more. No page below this layout may set openGraph or twitter from loop data.
  openGraph: {
    type: "website",
    siteName: copy.common.brand,
    title: copy.common.metadataTitle,
    description: copy.common.metadataDescription,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: copy.common.metadataTitle,
    description: copy.common.metadataDescription,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // One tag, not one per scheme: React re-hoists metadata during hydration and
  // multiplies media-scoped copies. The inline script below rewrites this value
  // to the scheme actually in use before first paint.
  themeColor: THEME_COLORS.light,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${nunito.variable} ${gaegu.variable} h-full antialiased`}
      data-theme="light"
      suppressHydrationWarning
    >
      <head>
        {/* Sets the theme before paint. It deliberately leaves the theme-color
            meta alone: rewriting a server-rendered tag here makes React insert a
            second one during hydration. ThemeSwitch updates the tag instead. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var s=localStorage.getItem("friendloop-theme"),d=document.documentElement;d.dataset.theme=s==="dark"||s==="light"?s:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light")}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full">
        <a href="#main-content" className="skip-link">{copy.common.skipToContent}</a>
        <div id="main-content" tabIndex={-1}>{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
