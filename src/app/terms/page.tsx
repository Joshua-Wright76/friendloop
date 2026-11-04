import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { copy } from "@/lib/copy";

export const metadata: Metadata = { title: copy.legal.terms.metadataTitle };

export default function TermsPage() {
  return <LegalPage document={copy.legal.terms} />;
}
