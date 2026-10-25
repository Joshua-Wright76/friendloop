import Link from "next/link";
import { Brand, Cherries, Tape } from "@/components/stationery";
import { copy } from "@/lib/copy";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-[880px] flex-col px-5 py-5 sm:min-h-dvh sm:px-8 sm:py-8">
      <header className="flex items-center justify-between gap-4">
        <Brand />
        <Link href="/signin" className="text-[14px] font-bold text-ink-soft underline decoration-dashed underline-offset-4 hover:text-ink">
          {copy.home.signIn}
        </Link>
      </header>

      <div className="flex flex-1 items-center py-8 sm:py-20">
        <section className="card home-card ride-in w-full">
          <Tape tone="dots" position="left" />
          <Cherries className="home-doodle" />
          <h1 className="home-title font-bold text-ink">
            {copy.home.titleStart} <em>{copy.home.titleAccent}</em>
          </h1>
          <p className="mt-6 max-w-[48ch] text-[17px] leading-relaxed text-ink-soft">
            {copy.home.description}
          </p>
          <div className="mt-8">
            <Link href="/signin" className="btn btn-primary">{copy.home.startLoop}</Link>
          </div>
        </section>
      </div>

    </main>
  );
}
