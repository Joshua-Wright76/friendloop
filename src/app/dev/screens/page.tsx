import Link from "next/link";
import { Brand, Tape } from "@/components/stationery";
import { copy } from "@/lib/copy";
import { requireUiPreview, UI_PREVIEW } from "@/lib/ui-preview";

export const instant = false;

export default async function UiScreensPage() {
  await requireUiPreview();

  const screens = copy.devUi.screens;
  const groups = [
    {
      title: copy.devUi.publicHeading,
      links: [
        [screens.home, "/"],
        [screens.signIn, "/dev/ui/signout"],
        [screens.checkEmail, "/signin/check-email"],
        [screens.confirm, `/signin/confirm?token=${UI_PREVIEW.magicToken}`],
        [screens.invalid, "/r/not-a-token"],
      ],
    },
    {
      title: copy.devUi.loopHeading,
      links: [
        [screens.yourLoops, "/you"],
        [screens.newLoop, "/g/new"],
        [screens.overview, `/g/${UI_PREVIEW.groupId}`],
        [screens.members, `/g/${UI_PREVIEW.groupId}/members`],
        [screens.questions, `/g/${UI_PREVIEW.groupId}/questions`],
        [screens.rounds, `/g/${UI_PREVIEW.groupId}/issues`],
        [screens.settings, `/g/${UI_PREVIEW.groupId}/settings`],
      ],
    },
    {
      title: copy.devUi.issueHeading,
      links: [
        [screens.reply, `/r/${UI_PREVIEW.ownerToken}`],
        [screens.issue, `/i/${UI_PREVIEW.deliveredIssueId}?m=${UI_PREVIEW.ownerToken}`],
        [screens.shared, `/s/${UI_PREVIEW.shareToken}`],
      ],
    },
    {
      title: copy.devUi.emailHeading,
      links: [
        [screens.emails, "/dev/emails"],
        [screens.outbox, "/dev/outbox"],
      ],
    },
  ];

  return (
    <main className="mx-auto w-full max-w-[820px] px-4 pb-16 pt-6 sm:px-6">
      <header className="mb-8 flex items-center justify-between gap-4">
        <Brand href={null} />
        <Link href="/dev/ui?reset=1" className="btn btn-quiet h-10 min-h-10 px-4 text-[13px]">
          {copy.devUi.reset}
        </Link>
      </header>

      <section className="card p-6 pt-8">
        <Tape tone="mint" position="right" />
        <h1 className="text-ink">{copy.devUi.title}</h1>
        <p className="mt-2 max-w-[52ch] text-[15px] leading-relaxed text-ink-soft">{copy.devUi.description}</p>
        <Link href="/dev/ui" className="btn btn-primary mt-4">{copy.devUi.enable}</Link>
      </section>

      <div className="mt-8 flex flex-col gap-8">
        {groups.map((group) => (
          <section key={group.title}>
            <h2 className="mb-3 text-ink">{group.title}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {group.links.map(([label, href]) => (
                <Link key={href} href={href} className="card loop-card flex items-center justify-between gap-4 px-4 py-3.5 no-underline">
                  <span className="font-display text-[22px] font-bold text-ink">{label}</span>
                  <span aria-hidden="true" className="text-ink-muted">→</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
