import type { Metadata, Viewport } from "next";
import { Gaegu, Nunito } from "next/font/google";
import { FeedbackButton } from "@/components/feedback-button";
import { ThemeSwitch } from "@/components/theme-switch";
import { copy } from "@/lib/copy";
import { THEME_COLORS } from "@/lib/theme";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
});

const gaegu = Gaegu({
  variable: "--font-gaegu",
  weight: ["400", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Every page names itself (2.4.2); the template keeps the brand on the end.
  title: { default: copy.common.metadataTitle, template: `%s · ${copy.common.brand}` },
  description: copy.common.metadataDescription,
  applicationName: copy.common.brand,
  appleWebApp: { capable: true, title: copy.common.brand, statusBarStyle: "black-translucent" },
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
        <FeedbackButton />
        <ThemeSwitch />
      </body>
    </html>
  );
}
