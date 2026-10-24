import type { Metadata, Viewport } from "next";
import { Gaegu, Nunito } from "next/font/google";
import { ThemeSwitch } from "@/components/theme-switch";
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
  title: "Friendloop",
  description: "A private newsletter for your friends. Answer a few questions, read everyone's.",
  applicationName: "Friendloop",
  appleWebApp: { capable: true, title: "Friendloop", statusBarStyle: "black-translucent" },
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
            __html: `try{if(localStorage.getItem("friendloop-theme")==="dark")document.documentElement.dataset.theme="dark"}catch{}`,
          }}
        />
      </head>
      <body className="min-h-full">
        {children}
        <ThemeSwitch />
      </body>
    </html>
  );
}
