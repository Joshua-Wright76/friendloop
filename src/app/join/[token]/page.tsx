import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { loopForInvite, placeIn } from "@/lib/invite-link";
import { Brand, Tape } from "@/components/stationery";
import { LoopBanner, LoopTheme } from "@/components/loop-theme";
import { LegalLinks } from "@/components/legal-page";
import { SafeForm } from "@/components/safe-form";
import { SubmitButton } from "@/components/submit-button";
import { copy, text } from "@/lib/copy";
import { joinNow, signOutToJoin } from "./actions";
import { JoinForm } from "./join-form";

// A couple of indexed queries; a blocking route is faster than a skeleton.
export const instant = false;

type Props = { params: Promise<{ token: string }> };

/**
 * The link is a (narrow) credential: kept out of indexes and Referer headers. A
 * chat app's preview of it shows Friendloop, never the loop's name, like every
 * other private page: preview services fetch and keep what they show.
 */
export const metadata: Metadata = {
  title: copy.pageTitles.join,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Where a loop's invite link lands. Opening it changes nothing: mail scanners and
 * link previews fetch it too. Joining is a POST, and for anyone not signed in it
 * only sends the email whose confirmation puts them in.
 */
export default async function JoinPage({ params }: Props) {
  const { token } = await params;
  const [loop, user] = await Promise.all([loopForInvite(token), currentUser()]);

  const place = loop && user ? await placeIn(loop.groupId, user) : null;
  if (loop && place === "in") redirect(`/g/${loop.groupId}`);

  const problem = !loop ? "gone" : place === "removed" ? "removed" : loop.full ? "full" : null;
  const values: Record<string, string | number> = loop ? { groupName: loop.groupName, ownerName: loop.ownerName, count: loop.people } : {};

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center px-4 py-10">
      {loop ? <LoopTheme group={loop.group} /> : null}
      <div className="mb-8 self-start"><Brand /></div>

      {loop ? <LoopBanner url={loop.group.headerImageUrl} className="mb-4" /> : null}

      <div className="card p-6 pt-8">
        <Tape tone="dots" position="center" />
        {problem ? (
          <>
            <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.022em] text-ink">
              {text(copy.join.problems[problem].title, values)}
            </h1>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{text(copy.join.problems[problem].body, values)}</p>
          </>
        ) : (
          <>
            <p className="eyebrow">{copy.join.eyebrow}</p>
            <h1 className="wrap-any text-[24px] font-semibold leading-tight tracking-[-0.022em] text-ink">
              {text(copy.join.title, values)}
            </h1>
            <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">
              {text(copy.join.lead, values)}{" "}
              {text(loop!.people > 1 ? copy.join.peopleMany : copy.join.peopleOne, values)}
            </p>

            {user ? (
              <div className="mt-5">
                <p className="text-[15px] leading-relaxed text-ink-soft">
                  {copy.join.signedInAs}{" "}
                  <strong className="block font-extrabold text-ink [overflow-wrap:anywhere]">{user.email}</strong>
                </p>
                <SafeForm action={joinNow} className="mt-4">
                  <input type="hidden" name="token" value={token} />
                  <SubmitButton className="btn btn-primary w-full">{text(copy.join.joinNow, values)}</SubmitButton>
                </SafeForm>
                <SafeForm action={signOutToJoin} className="mt-3 flex items-center justify-center gap-1.5 text-[14px] text-ink-soft">
                  <input type="hidden" name="token" value={token} />
                  <span>{copy.join.notYou}</span>
                  <SubmitButton className="link">{copy.common.signOut}</SubmitButton>
                </SafeForm>
              </div>
            ) : (
              <div className="mt-5">
                <JoinForm token={token} />
                <p className="mt-3 text-center">
                  <Link href="/signin/check-email" className="inline-flex min-h-11 items-center text-[14px] font-bold text-accent-ink underline decoration-accent/30 underline-offset-4">
                    {copy.join.haveCode}
                  </Link>
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <LegalLinks className="mt-6" />
    </main>
  );
}
