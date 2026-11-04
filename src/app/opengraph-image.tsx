import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { copy } from "@/lib/copy";

/*
 * The one link-preview card for the whole site. It sits at the root, so every
 * route inherits it — on purpose: a private page (a reply link, a round, an
 * album) then previews as Friendloop, and a scraper never falls back to the
 * first photo on the page. Nothing here reads loop data; it renders at build.
 */

export const alt = `${copy.common.brand}: ${copy.home.titleStart} ${copy.home.titleAccent}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Light-theme Gingham Picnic tokens from globals.css.
const PAGE = "#fff3f5";
const CHECK = "rgba(236, 118, 148, 0.15)";
const CARD = "#fffdfa";
const LINE = "#f1dae0";
const INK = "#3d2a30";
const INK_SOFT = "#674d55";
const ACCENT = "#cc3456";
const TAPE = "#f6a6ba";

const fonts = join(process.cwd(), "src/assets/fonts");

function Cherries({ size: px }: { size: number }) {
  return (
    <svg width={px} height={px} viewBox="0 0 32 32">
      <path d="M16 4c-2.5 6-6 10-8.6 13M16 4c1.2 6 4 9.6 7.6 12" fill="none" stroke="#5b8a4a" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16 4c3-2.6 7.5-2.4 9.5.4-3.4 2-6.6 1.8-9.5-.4z" fill="#7cb35f" />
      <circle cx="8" cy="22" r="6" fill="#e0405e" />
      <circle cx="23.6" cy="21" r="6" fill="#e0405e" />
      <circle cx="5.8" cy="19.8" r="1.7" fill="#fff" opacity=".75" />
      <circle cx="21.4" cy="18.8" r="1.7" fill="#fff" opacity=".75" />
    </svg>
  );
}

export default async function Image() {
  const [gaegu, nunito] = await Promise.all([
    readFile(join(fonts, "Gaegu-700.ttf")),
    readFile(join(fonts, "Nunito-700.ttf")),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: PAGE,
          backgroundImage: `linear-gradient(90deg, ${CHECK} 50%, transparent 0), linear-gradient(${CHECK} 50%, transparent 0)`,
          backgroundSize: "48px 48px",
        }}
      >
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            width: 1000,
            padding: "56px 64px",
            backgroundColor: CARD,
            border: `2px solid ${LINE}`,
            borderRadius: 10,
            boxShadow: "0 28px 50px -30px rgba(160, 40, 70, 0.45)",
          }}
        >
          {/* Tape across the top-left corner, as on the landing card. */}
          <div
            style={{
              position: "absolute",
              top: -18,
              left: 44,
              width: 150,
              height: 36,
              backgroundColor: TAPE,
              opacity: 0.9,
              transform: "rotate(-4deg)",
            }}
          />
          <div style={{ position: "absolute", top: -50, right: 48, display: "flex", transform: "rotate(12deg)" }}>
            <Cherries size={120} />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, color: INK, fontFamily: "Gaegu", fontSize: 44 }}>
            <Cherries size={46} />
            {copy.common.brand}
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              marginTop: 28,
              fontFamily: "Gaegu",
              fontSize: 96,
              lineHeight: 0.98,
              color: INK,
            }}
          >
            <span>{copy.home.titleStart}&nbsp;</span>
            <span style={{ color: ACCENT }}>{copy.home.titleAccent}</span>
          </div>

          <div style={{ display: "flex", marginTop: 32, fontFamily: "Nunito", fontSize: 32, color: INK_SOFT }}>
            {copy.home.description}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Gaegu", data: gaegu, weight: 700, style: "normal" },
        { name: "Nunito", data: nunito, weight: 700, style: "normal" },
      ],
    },
  );
}
