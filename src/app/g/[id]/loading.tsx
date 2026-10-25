import { copy } from "@/lib/copy";

export default function LoopLoading() {
  return (
    <main className="mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6" aria-busy="true">
      <div className="stitched mb-8 h-12 border-b" />
      <div className="loop-nav" aria-hidden="true">
        <span className="h-5 w-16 rounded bg-accent-soft" />
        <span className="h-5 w-14 rounded bg-accent-soft" />
        <span className="h-5 w-20 rounded bg-accent-soft" />
      </div>
      <div role="status" className="sr-only">{copy.common.loading}</div>
      <div className="h-9 w-48 rounded-md bg-accent-soft" />
      <div className="card mt-6 h-40 animate-pulse" />
      <div className="card mt-5 h-28 animate-pulse" />
    </main>
  );
}
