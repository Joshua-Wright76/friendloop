import Link from "next/link";
import { Brand, Tape } from "@/components/stationery";
import { copy } from "@/lib/copy";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-[560px] flex-col justify-center px-4 py-10">
      <div className="mb-8 self-start">
        <Brand />
      </div>
      <div className="card p-6 pt-8">
        <Tape tone="mint" position="left" />
        <h1 className="text-ink">{copy.common.notFound.title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{copy.common.notFound.body}</p>
        <Link href="/" className="btn btn-primary mt-5 inline-flex">
          {copy.common.notFound.home}
        </Link>
      </div>
    </main>
  );
}
