import type { Metadata, Viewport } from "next";
import { Gaegu, Nunito } from "next/font/google";
import { ThemeSwitch } from "@/components/theme-switch";
import { copy } from "@/lib/copy";
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
  title: copy.common.metadataTitle,
  description: copy.common.metadataDescription,
  applicationName: copy.common.brand,
  appleWebApp: { capable: true, title: copy.common.brand, statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fff3f5",
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
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("friendloop-theme")==="dark"){document.documentElement.dataset.theme="dark";document.querySelector('meta[name="theme-color"]')?.setAttribute("content","#241a20")}}catch{}`,
          }}
        />
      </head>
      <body className="min-h-full">
        <a href="#main-content" className="skip-link">{copy.common.skipToContent}</a>
        <div id="main-content" tabIndex={-1}>{children}</div>
        <ThemeSwitch />
      </body>
    </html>
  );
}
