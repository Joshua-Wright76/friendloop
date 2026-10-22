import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center px-4 py-10">
      <span className="mb-8 flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-ink">
        <span className="grid h-6 w-6 place-items-center rounded-[7px] bg-accent text-[13px] font-bold text-white">
          f
        </span>
        Friendloop
      </span>

      <h1 className="text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink">
        A newsletter for your friends, written by your friends.
      </h1>

      <p className="mt-4 max-w-[38ch] text-[16px] leading-relaxed text-ink-soft">
        A few questions go out each week. Everyone answers in a sentence. It comes back as
        something worth reading.
      </p>

      <div className="mt-8 flex flex-col gap-3">
        <Link href="/signin" className="btn btn-primary w-full">
          Start a loop
        </Link>
        <p className="text-[13px] leading-relaxed text-ink-muted">
          Answering questions? Use the link in your email — no account needed.
        </p>
      </div>
    </main>
  );
}
