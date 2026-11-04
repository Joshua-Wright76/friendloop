import type { Metadata } from "next";

/** Preview and inbox tools: never indexed, never a referrer (the keyed URL is a secret). */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function DevLayout({ children }: LayoutProps<"/dev">) {
  return children;
}
