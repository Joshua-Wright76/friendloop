import { emailPreviews } from "@/lib/email/previews";
import { copy, text } from "@/lib/copy";

export const instant = false;

/** Every email template, rendered with sample data and its plain-text twin. */
export default async function DevEmailsPage() {
  return (
    <main className="mx-auto w-full max-w-[760px] px-4 pb-16 pt-5 sm:px-6">
      <header className="stitched mb-8 flex items-center justify-between gap-3 border-b pb-4">
        <span className="font-display text-[23px] font-bold text-ink">{copy.devEmails.title}</span>
        <a href="/dev/screens" className="text-[13px] font-medium text-ink-soft hover:text-ink">
          {copy.devEmails.back}
        </a>
      </header>

      <p className="max-w-[52ch] text-[15px] leading-relaxed text-ink-soft">{copy.devEmails.description}</p>

      <div className="mt-8 flex flex-col gap-8">
        {emailPreviews().map((preview) => (
          <section key={preview.id} className="card p-5">
            <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-ink">
              {copy.devEmails.previews[preview.id as keyof typeof copy.devEmails.previews]}
            </h2>
            <p className="mt-1 text-[13px] text-ink-muted">
              {text(copy.devEmails.subject, { subject: preview.email.subject })}
            </p>
            <iframe
              title={preview.id}
              srcDoc={preview.email.html}
              sandbox=""
              className="mt-3 h-[640px] w-full rounded-lg border border-line bg-white"
            />
            <details className="mt-3">
              <summary className="cursor-pointer text-[13px] font-medium text-ink-soft">
                {copy.devEmails.plainText}
              </summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg border border-line bg-field p-4 text-[13px] leading-relaxed text-ink">
                {preview.email.text}
              </pre>
            </details>
          </section>
        ))}
      </div>
    </main>
  );
}
