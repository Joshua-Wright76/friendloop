import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MUSIC_TRACKS_KEPT,
  clockSeconds,
  decodeEntities,
  formatTrackTime,
  metadataUrl,
  parseMusicPage,
} from "./music-meta.ts";

function spotifyEmbed(entity: unknown): string {
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { state: { data: { entity } } } },
  })}</script></html>`;
}

test("each provider's metadata comes from the page that carries it", () => {
  assert.equal(
    metadataUrl("spotify", "https://open.spotify.com/intl-de/album/1DFixLWuPkv3KT3TnV35m3?si=abc"),
    "https://open.spotify.com/embed/album/1DFixLWuPkv3KT3TnV35m3",
  );
  assert.equal(metadataUrl("spotify", "https://open.spotify.com/playlist/37i9"), "https://open.spotify.com/embed/playlist/37i9");
  // The open. and play. apps are a shell; the store page answers under any slug.
  assert.equal(metadataUrl("qobuz", "https://open.qobuz.com/playlist/2007557"), "https://www.qobuz.com/us-en/playlists/x/2007557");
  assert.equal(metadataUrl("qobuz", "https://play.qobuz.com/album/k78gk9w1fsqtc"), "https://www.qobuz.com/us-en/album/x/k78gk9w1fsqtc");
  assert.equal(metadataUrl("qobuz", "https://open.qobuz.com/track/103395115"), "https://open.qobuz.com/track/103395115");
  const store = "https://www.qobuz.com/us-en/playlists/john-carpenter-1/2007557";
  assert.equal(metadataUrl("qobuz", store), store);
  const bandcamp = "https://radiohead.bandcamp.com/album/in-rainbows";
  assert.equal(metadataUrl("bandcamp", bandcamp), bandcamp);
});

test("a Spotify embed gives the title, artist, 300px cover, and songs", () => {
  const tracks = Array.from({ length: 12 }, (_, index) => ({ title: `Song ${index + 1}`, subtitle: "Carly Rae Jepsen", duration: 251_320 }));
  const meta = parseMusicPage("spotify", spotifyEmbed({
    name: "Emotion",
    subtitle: "Carly Rae Jepsen",
    trackList: [...tracks, { subtitle: "untitled rows are dropped" }],
    visualIdentity: { image: [{ url: "https://img/64", maxWidth: 64 }, { url: "https://img/300", maxWidth: 300 }] },
  }));
  assert.equal(meta?.title, "Emotion — Carly Rae Jepsen");
  assert.equal(meta?.artworkUrl, "https://img/300");
  assert.equal(meta?.trackCount, 12);
  assert.equal(meta?.tracks.length, MUSIC_TRACKS_KEPT);
  assert.deepEqual(meta?.tracks[0], { title: "Song 1", artist: "Carly Rae Jepsen", seconds: 251 });
});

test("a Spotify track or a sparse entity still makes a card", () => {
  const single = parseMusicPage("spotify", spotifyEmbed({
    title: "Never Gonna Give You Up",
    trackList: [{ title: "Never Gonna Give You Up" }],
    visualIdentity: { image: [{ url: "https://img/640", maxWidth: 640 }] },
  }));
  assert.equal(single?.title, "Never Gonna Give You Up");
  assert.equal(single?.artworkUrl, "https://img/640");
  assert.deepEqual(single?.tracks, [{ title: "Never Gonna Give You Up", artist: null, seconds: null }]);

  const coverOnly = parseMusicPage("spotify", spotifyEmbed({ visualIdentity: { image: [{ url: "https://img/a" }] } }));
  assert.deepEqual(coverOnly, { title: null, artworkUrl: "https://img/a", tracks: [], trackCount: 0 });

  assert.equal(parseMusicPage("spotify", spotifyEmbed({})), null);
  assert.equal(parseMusicPage("spotify", spotifyEmbed(null)), null);
  assert.equal(parseMusicPage("spotify", '<script id="__NEXT_DATA__">{not json</script>'), null);
  assert.equal(parseMusicPage("spotify", "<html></html>"), null);
});

test("a Bandcamp album page gives its byline, cover, and track table", () => {
  const row = (title: string, time: string) =>
    `<tr class="track_row_view linked"><td><span class="track-title">${title}</span><span class="time secondaryText">\n  ${time}\n</span></td></tr>`;
  const html = [
    '<meta property="og:title" content="In Rainbows, by Radiohead">',
    '<meta property="og:image" content="https://f4.bcbits.com/img/a1_5.jpg">',
    '<table id="track_table">',
    row("15 Step", "03:57"),
    row("Weird Fishes/ Arpeggi", "05:18"),
    row("Nude &amp; Co", ""),
    '<tr class="track_row_view"><td>no title here</td></tr>',
    "</table>",
  ].join("\n");
  const meta = parseMusicPage("bandcamp", html);
  assert.equal(meta?.title, "In Rainbows — Radiohead");
  assert.equal(meta?.artworkUrl, "https://f4.bcbits.com/img/a1_5.jpg");
  assert.equal(meta?.trackCount, 3);
  assert.deepEqual(meta?.tracks, [
    { title: "15 Step", artist: null, seconds: 237 },
    { title: "Weird Fishes/ Arpeggi", artist: null, seconds: 318 },
    { title: "Nude & Co", artist: null, seconds: null },
  ]);

  const plain = parseMusicPage("bandcamp", '<meta property="og:title" content="Just a title">');
  assert.deepEqual(plain, { title: "Just a title", artworkUrl: null, tracks: [], trackCount: 0 });
  const coverOnly = parseMusicPage("bandcamp", '<meta property="og:image" content="https://img/b.jpg">');
  assert.equal(coverOnly?.title, null);
  assert.equal(parseMusicPage("bandcamp", "<html>"), null);
});

test("a Qobuz playlist reads its page title, songs, and declared length", () => {
  const row = (title: string, artist: string, time: string) =>
    `<div class="track track--playlist" data-duration="300"><div class="track__item track__item--name" title="${title}">\n<span>${title}</span></div>` +
    `<span class="track__item track__item--artist" title="${artist}"><a>${artist}</a></span>` +
    `<span class="track__item track__item--duration">${time}</span></div>`;
  const html = [
    "<title>Playlist John Carpenter - Streaming Hi-Res - Qobuz</title>",
    '<meta property="og:title" content="Qobuz">',
    '<meta property="og:image" content="https://www.qobuz.com/assets-static/img/logo/qobuz_logo_og.png">',
    '<div id="playerTracks" data-nbtracks="39">',
    '<div class="track--heading track--playlist"><span class="track__item track__item--name">Title</span></div>',
    row("Weeping Ghost", "John Carpenter", "00:03:33"),
    row("Angel&#039;s Asylum", "", "00:04:17"),
  ].join("\n");
  const meta = parseMusicPage("qobuz", html);
  assert.equal(meta?.title, "John Carpenter");
  assert.equal(meta?.artworkUrl, null, "the site logo is not a cover");
  assert.equal(meta?.trackCount, 39);
  assert.deepEqual(meta?.tracks, [
    { title: "Weeping Ghost", artist: "John Carpenter", seconds: 213 },
    { title: "Angel's Asylum", artist: null, seconds: 257 },
  ]);
});

test("a Qobuz album uses og tags, and an empty page makes no card", () => {
  const html = [
    '<meta property="og:title" content="Weeping Ghost, John Carpenter - Qobuz">',
    '<meta property="og:image" content="https://static.qobuz.com/images/covers/k7_600.jpg">',
    '<div class="track track-first " data-duration="300"><div class="track__item track__item--name" itemprop="name">\n<span>Weeping Ghost</span></div></div>',
    '<div class="track__overlay"></div>',
    '<div class="track track-last"><div class="track__item track__item--name"><b>no span</b></div></div>',
  ].join("\n");
  const meta = parseMusicPage("qobuz", html);
  assert.equal(meta?.title, "Weeping Ghost, John Carpenter");
  assert.equal(meta?.artworkUrl, "https://static.qobuz.com/images/covers/k7_600.jpg");
  assert.deepEqual(meta?.tracks, [{ title: "Weeping Ghost", artist: null, seconds: null }]);
  assert.equal(meta?.trackCount, 1);

  assert.equal(parseMusicPage("qobuz", "<title>Qobuz</title>"), null, "a bare brand name is not a title");
  assert.equal(parseMusicPage("qobuz", '<meta property="og:title" content="Qobuz">'), null);
  assert.equal(parseMusicPage("qobuz", "<html>"), null);
});

test("track times read and print the way the providers show them", () => {
  assert.equal(clockSeconds("03:57"), 237);
  assert.equal(clockSeconds("00:03:33"), 213);
  assert.equal(clockSeconds("1:02:05"), 3725);
  assert.equal(clockSeconds(undefined), null);
  assert.equal(clockSeconds("3:x"), null);
  assert.equal(formatTrackTime(237), "3:57");
  assert.equal(formatTrackTime(65), "1:05");
  assert.equal(formatTrackTime(3725), "1:02:05");
});

test("entities decode, and a missing value stays missing", () => {
  assert.equal(decodeEntities("Tom &amp; Jerry &lt;3 &gt; &quot;hi&quot; it&#39;s it&#039;s"), `Tom & Jerry <3 > "hi" it's it's`);
  assert.equal(decodeEntities(null), null);
  assert.equal(decodeEntities(""), null);
});
