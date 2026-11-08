import { copy, text } from "@/lib/copy";
import { formatTrackTime, type MusicTrack } from "@/lib/music-meta";
import { MusicArt } from "./music-art";

const SHOWN = 3;

const PROVIDERS: Record<string, string> = { spotify: "Spotify", bandcamp: "Bandcamp", qobuz: "Qobuz" };

/** A pasted music link in the provider's colours, with its first few songs. */
export function MusicCard({
  url,
  provider,
  title,
  artworkUrl,
  tracks,
  trackCount,
}: {
  url: string;
  provider: string | null;
  title: string | null;
  artworkUrl: string | null;
  tracks: MusicTrack[];
  trackCount: number;
}) {
  const name = provider ? (PROVIDERS[provider] ?? provider) : null;
  // A single track is already the title; a list only helps for albums and playlists.
  const shown = trackCount > 1 ? tracks.slice(0, SHOWN) : [];
  const more = trackCount - shown.length;
  // On an album every row repeats the same artist; only a mix needs them.
  const mixed = new Set(shown.map((track) => track.artist)).size > 1;

  return (
    <div className={`music-card music-card-${provider ?? "other"}`}>
      <a href={url} target="_blank" rel="noreferrer" className="music-card-head">
        <MusicArt src={artworkUrl} fallback={<ProviderIcon provider={provider} />} />
        <span className="min-w-0 flex-1">
          <span className="block wrap-any text-[14px] font-bold">{title ?? url}</span>
          {name ? (
            <span className="music-card-provider">
              <ProviderIcon provider={provider} />
              {name}
            </span>
          ) : null}
        </span>
        <span aria-hidden="true" className="music-card-out">↗</span>
      </a>
      {shown.length > 0 ? (
        <ol className="music-card-tracks" aria-label={copy.issue.musicSongs}>
          {shown.map((track, index) => (
            <li key={`${index}-${track.title}`}>
              <span className="music-card-num numeric">{index + 1}</span>
              <span className="min-w-0 flex-1 wrap-any">
                {track.title}
                {mixed && track.artist ? <span className="music-card-sub"> · {track.artist}</span> : null}
              </span>
              {track.seconds ? <span className="music-card-sub numeric">{formatTrackTime(track.seconds)}</span> : null}
            </li>
          ))}
          {more > 0 ? (
            <li className="music-card-more">
              {more === 1 ? copy.issue.musicMoreSongsOne : text(copy.issue.musicMoreSongs, { count: more })}
            </li>
          ) : null}
        </ol>
      ) : null}
    </div>
  );
}

function ProviderIcon({ provider }: { provider: string | null }) {
  if (provider === "spotify") {
    return (
      <svg viewBox="0 0 24 24" className="music-card-icon" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"
        />
      </svg>
    );
  }
  if (provider === "bandcamp") {
    return (
      <svg viewBox="0 0 24 24" className="music-card-icon" aria-hidden="true">
        <path fill="currentColor" d="M0 18.75l7.437-13.5H24l-7.438 13.5H0z" />
      </svg>
    );
  }
  if (provider === "qobuz") {
    // Qobuz's own "qbz" mark (static.qobuz.com/images/favicon/favicon.svg), cropped to the letters.
    return (
      <svg viewBox="19 37 143 110" className="music-card-icon music-card-icon-wide" aria-hidden="true">
        <path fill="currentColor" d="M154.98,107.69s-.06,0-.09,0h-20.06c6.73-8.99,22.89-30.61,22.9-30.62.73-1.01,1.17-2.25,1.17-3.59,0-3.32-2.65-6.01-5.95-6.08h0s-24.55,0-24.55,0h-.15s.14,0,.13,0c-2.34,0-4.38,1.9-4.38,4.24s1.9,4.23,4.23,4.23c.03,0,.06,0,.1,0h19.74s-22.82,30.51-22.84,30.53c-.77,1.02-1.23,2.29-1.23,3.67,0,3.37,2.73,6.09,6.09,6.09h24.88s0,0,.01,0c2.15,0,3.89-1.9,3.89-4.23s-1.74-4.23-3.89-4.23Z" />
        <path fill="currentColor" d="M45.53,115.85c4.68,0,9.06-1.32,12.77-3.61v-11.25c-2.91,3.88-7.55,6.39-12.77,6.39-8.81,0-15.96-7.15-15.96-15.96s7.14-15.96,15.96-15.96,15.96,7.15,15.96,15.96h0v43.76s0,.03,0,.05c0,2.34,1.9,4.24,4.23,4.24s4.23-1.9,4.23-4.24c0-.02,0-.03,0-.05v-43.76c0-13.49-10.93-24.43-24.42-24.43s-24.42,10.94-24.42,24.43,10.93,24.43,24.42,24.43Z" />
        <path fill="currentColor" d="M99.42,66.97c-4.68,0-9.06,1.32-12.77,3.61v11.25c2.91-3.88,7.55-6.39,12.77-6.39,8.81,0,15.96,7.15,15.96,15.96s-7.14,15.96-15.96,15.96-15.96-7.15-15.96-15.96h0v-43.76s0-.03,0-.05c0-2.34-1.9-4.24-4.23-4.24s-4.23,1.9-4.23,4.24c0,.02,0,.03,0,.05v43.76c0,13.49,10.93,24.43,24.42,24.43s24.42-10.94,24.42-24.43-10.93-24.43-24.42-24.43Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="music-card-icon" aria-hidden="true">
      <path fill="currentColor" d="M9 3v11.55A4 4 0 1 0 11 18V8h8V3H9z" />
    </svg>
  );
}
