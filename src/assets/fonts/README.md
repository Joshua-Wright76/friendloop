Latin subsets of Gaegu 700 and Nunito 700 (SIL Open Font License 1.1), used only
by `src/app/opengraph-image.tsx`: `next/og` needs raw font bytes, and fetching
them during the build would make it depend on the network. The pages themselves
load the same families through `next/font` in `src/app/layout.tsx`.

Regenerate with the Google Fonts CSS API, `text=` set to printable ASCII plus
curly quotes, ellipsis, middle dot, and dashes.
