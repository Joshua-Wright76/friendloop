import Link from "next/link";
import { Brand, Tape } from "@/components/stationery";
import { copy, text } from "@/lib/copy";

export type LegalSection = { heading: string; paragraphs?: string[]; items?: string[] };

export type LegalDocument = {
  eyebrow: string;
  title: string;
  intro: string;
  sections: LegalSection[];
};

/** A contact line that only becomes a mail link once a real address is filled in. */
function Contact() {
  const address = copy.legal.contactEmail;
  return address.includes("@") && !address.includes(" ") ? (
    <a href={`mailto:${address}`} className="font-bold text-ink underline decoration-line-strong underline-offset-4">
      {address}
    </a>
  ) : (
    <span className="font-bold text-ink">{address}</span>
  );
}

/** Privacy and terms share one plain reading layout: cream paper, stitched headings. */
export function LegalPage({ document }: { document: LegalDocument }) {
  return (
    <main className="mx-auto w-full max-w-[720px] px-4 pb-16 pt-6 sm:px-6">
      <header className="mb-8">
        <Brand />
      </header>
      <article className="card p-6 pt-8 sm:p-8">
        <Tape tone="stripe" position="left" />
        <p className="eyebrow">{document.eyebrow}</p>
        <h1 className="mt-1 text-ink">{document.title}</h1>
        <p className="mt-4 max-w-[62ch] text-[16px] leading-relaxed text-ink-soft">{document.intro}</p>

        {document.sections.map((section) => (
          <section key={section.heading} className="stitched-top mt-7 border-t pt-5">
            <h2 className="text-[22px] text-ink">{section.heading}</h2>
            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph} className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-ink-soft">{paragraph}</p>
            ))}
            {section.items ? (
              <ul className="mt-3 grid max-w-[62ch] list-disc gap-2 pl-5 text-[15px] leading-relaxed text-ink-soft">
                {section.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : null}
          </section>
        ))}

        <section className="stitched-top mt-7 border-t pt-5">
          <h2 className="text-[22px] text-ink">{copy.legal.contactHeading}</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
            {copy.legal.contactBody} <Contact />
          </p>
          <p className="mt-3 text-[13px] text-ink-muted">{text(copy.legal.lastUpdated, { date: copy.legal.updatedOn })}</p>
        </section>
      </article>
      <LegalLinks className="mt-6" />
    </main>
  );
}

/** The footer pair every public surface carries. */
export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <nav aria-label={copy.legal.footerLabel} className={`flex flex-wrap justify-center gap-x-5 gap-y-2 text-[13px] text-ink-muted ${className}`}>
      <Link href="/privacy" className="underline decoration-line-strong underline-offset-4 hover:text-ink">{copy.legal.privacyLink}</Link>
      <Link href="/terms" className="underline decoration-line-strong underline-offset-4 hover:text-ink">{copy.legal.termsLink}</Link>
    </nav>
  );
}
