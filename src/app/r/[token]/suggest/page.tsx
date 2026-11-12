import type { Metadata } from "next";
import { resolveToken } from "@/lib/reply";
import { copy } from "@/lib/copy";
import { SuggestForm } from "./suggest-form";
import { LoopPageHeader, LoopTheme } from "@/components/loop-theme";
import { Brand, Tape } from "@/components/stationery";
import { DeadLinkPage } from "@/components/dead-link";

// One indexed query behind this page; a blocking route is faster than a skeleton.
export const instant = false;

// Same credential rules as the reply sheet: never indexed, never leaked.
export const metadata: Metadata = {
  title: copy.pageTitles.suggest,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function Closed({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center px-4 py-10">
      <div className="mb-8 self-start"><Brand /></div>
      <div className="card p-6 pt-8">
        <Tape tone="stripe" position="center" />
        <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.022em] text-ink">{title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{body}</p>
      </div>
    </main>
  );
}

export default async function SuggestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const context = await resolveToken(token);

  if (context.state === "invalid") {
    return <DeadLinkPage title={copy.reply.invalidTitle} body={copy.reply.invalidBody} next={copy.reply.invalidNext} />;
  }

  if (context.state === "reader") {
    return <Closed title={copy.suggest.unavailableTitle} body={copy.suggest.unavailableBody} />;
  }

  const displayName = context.membership.name ?? context.membership.email.split("@")[0];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center px-4 py-10">
      {/* Written on the loop's own stationery, like the reply sheet it came from. */}
      <LoopTheme group={context.group} />
      <LoopPageHeader name={context.group.name} imageUrl={context.group.headerImageUrl} />
      <div className="card p-6 pt-8">
        <Tape tone="dots" position="left" />
        <h1 className="text-ink">
          {copy.suggest.title}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{copy.suggest.description}</p>
        <SuggestForm token={token} displayName={displayName} />
      </div>
    </main>
  );
}
