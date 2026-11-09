import Link from "next/link";
import { Brand, Tape } from "@/components/stationery";
import { copy } from "@/lib/copy";
import { PREVIEW_LOOKS, UI_PREVIEW, capturedInboxAllowed, type PreviewLookKey } from "@/lib/ui-preview";

export const instant = false;

export default async function UiScreensPage() {
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
        [screens.roundsFiltered, `/g/${UI_PREVIEW.groupId}/issues?member=${UI_PREVIEW.aliceMembershipId}`],
        [screens.album, `/g/${UI_PREVIEW.groupId}/album`],
        [screens.settings, `/g/${UI_PREVIEW.groupId}/settings`],
      ],
    },
    {
      title: copy.devUi.issueHeading,
      links: [
        [screens.reply, `/r/${UI_PREVIEW.ownerToken}`],
        [screens.suggest, `/r/${UI_PREVIEW.aliceToken}/suggest`],
        [screens.issue, `/i/${UI_PREVIEW.deliveredIssueId}?m=${UI_PREVIEW.ownerToken}`],
        [screens.issueOnePerson, `/i/${UI_PREVIEW.deliveredIssueId}?m=${UI_PREVIEW.ownerToken}&by=${UI_PREVIEW.aliceMembershipId}`],
        [screens.issueByPerson, `/i/${UI_PREVIEW.deliveredIssueId}?m=${UI_PREVIEW.ownerToken}&sort=member`],
        [screens.issuePrint, `/i/${UI_PREVIEW.deliveredIssueId}?print&m=${UI_PREVIEW.ownerToken}`],
        [screens.albumAsReader, `/album/${UI_PREVIEW.groupId}?m=${UI_PREVIEW.aliceToken}`],
        [screens.shared, `/s/${UI_PREVIEW.shareToken}`],
        [screens.sharedPrint, `/s/${UI_PREVIEW.shareToken}?print`],
      ],
    },
    {
      title: copy.devUi.customizeHeading,
      links: [
        [screens.stationery, `/g/${UI_PREVIEW.groupId}/settings?stationery=open`],
        [screens.charmAndFrame, `/g/${UI_PREVIEW.groupId}/members?look=open`],
      ],
    },
    {
      title: copy.devUi.looksHeading,
      links: (Object.keys(PREVIEW_LOOKS) as PreviewLookKey[]).map((key) => [copy.devUi.looks[key], `/dev/ui/wear?look=${key}`]),
    },
    {
      title: copy.devUi.emailHeading,
      links: [
        [screens.emails, "/dev/emails"],
        ...(capturedInboxAllowed() ? [[screens.outbox, "/dev/outbox"] as [string, string]] : []),
        [screens.feedback, "/dev/feedback"],
      ],
    },
  ];

  return (
    <main className="mx-auto w-full max-w-[820px] px-4 pb-16 pt-6 sm:px-6">
      <header className="mb-8 flex items-center justify-between gap-4">
        <Brand href={null} />
        {/* prefetch={false}: these links sign out and reset the demo data, and Next would otherwise fetch them just for rendering this page. */}
        <Link href="/dev/ui?reset=1" prefetch={false} className="btn btn-quiet h-10 min-h-10 px-4 text-[13px]">
          {copy.devUi.reset}
        </Link>
      </header>

      <section className="card p-6 pt-8">
        <Tape tone="mint" position="right" />
        <h1 className="text-ink">{copy.devUi.title}</h1>
        <p className="mt-2 max-w-[52ch] text-[15px] leading-relaxed text-ink-soft">{copy.devUi.description}</p>
        <Link href="/dev/ui" prefetch={false} className="btn btn-primary mt-4">{copy.devUi.enable}</Link>
      </section>

      <div className="mt-8 flex flex-col gap-8">
        {groups.map((group) => (
          <section key={group.title}>
            <h2 className="mb-3 text-ink">{group.title}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {group.links.map(([label, href]) => (
                <Link key={href} href={href} prefetch={false} className="card loop-card flex items-center justify-between gap-4 px-4 py-3.5 no-underline">
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
