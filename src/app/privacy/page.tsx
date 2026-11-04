import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { copy } from "@/lib/copy";

export const metadata: Metadata = { title: copy.legal.privacy.metadataTitle };

export default function PrivacyPage() {
  return <LegalPage document={copy.legal.privacy} />;
}
