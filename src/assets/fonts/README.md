Latin subsets of Gaegu 700 and Nunito 700 (SIL Open Font License 1.1), used only
by `src/app/opengraph-image.tsx`: `next/og` needs raw font bytes, and fetching
them during the build would make it depend on the network. The pages themselves
load the same families through `next/font` in `src/app/layout.tsx`.

Regenerate with the Google Fonts CSS API, `text=` set to printable ASCII plus
curly quotes, ellipsis, middle dot, and dashes.

`gaegu-latin-400.woff2` and `gaegu-latin-700.woff2` are Google Fonts' own `latin`
subset files for Gaegu (same license), loaded by `src/app/layout.tsx` through
`next/font/local`. Google's full Gaegu is mostly Korean, and several of its Korean
subsets also claim ASCII, so `next/font/google` made every page fetch dozens of them.
