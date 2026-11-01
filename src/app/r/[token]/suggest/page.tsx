import Link from "next/link";
import type { Metadata } from "next";
import { resolveToken } from "@/lib/reply";
import { copy, text } from "@/lib/copy";
import { SuggestForm } from "./suggest-form";

// One indexed query behind this page; a blocking route is faster than a skeleton.
export const instant = false;

// Same credential rules as the reply sheet: never indexed, never leaked.
export const metadata: Metadata = {
  title: copy.common.brand,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function Closed({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center px-4 py-10">
      <div className="card p-6">
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          {title}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{body}</p>
      </div>
      <p className="mt-6 text-center text-[13px] text-ink-muted">
        <Link href="/" className="underline decoration-line-strong underline-offset-4">
          {copy.common.brand}
        </Link>
      </p>
    </main>
  );
}

export default async function SuggestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const context = await resolveToken(token);

  if (context.state === "invalid") {
    return <Closed title={copy.reply.invalidTitle} body={copy.reply.invalidBody} />;
  }

  if (context.state === "expired") {
    return (
      <Closed
        title={copy.reply.expiredTitle}
        body={text(copy.reply.expiredBody, { groupName: context.groupName })}
      />
    );
  }

  if (context.state === "reader" || context.group.mode === "from_you") {
    return <Closed title={copy.suggest.unavailableTitle} body={copy.suggest.unavailableBody} />;
  }

  const displayName = context.membership.name ?? context.membership.email.split("@")[0];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center px-4 py-10">
      <div className="card p-6">
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          {copy.suggest.title}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{copy.suggest.description}</p>
        <SuggestForm token={token} displayName={displayName} />
      </div>
      <p className="mt-6 text-center text-[13px] text-ink-muted">
        <Link href={`/r/${token}`} className="underline decoration-line-strong underline-offset-4">
          {copy.suggest.backToSheet}
        </Link>
      </p>
    </main>
  );
}
