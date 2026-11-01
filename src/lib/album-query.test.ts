import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALBUM_MAX_PAGES,
  albumHref,
  escapeLike,
  issueAnchor,
  parseAlbumFilters,
  searchTerms,
} from "./album-query.ts";

const ID = "3f2c9d6e-1a4b-4c8d-9e7f-0a1b2c3d4e5f";

test("filters come from the URL, and a bad value is the same as no filter", () => {
  assert.deepEqual(parseAlbumFilters({}), { member: null, q: "", pages: 1 });
  assert.deepEqual(parseAlbumFilters({ member: ID.toUpperCase(), q: "  goose   lake ", pages: "3" }), {
    member: ID,
    q: "goose lake",
    pages: 3,
  });
  assert.equal(parseAlbumFilters({ member: "not-a-uuid" }).member, null);
  assert.equal(parseAlbumFilters({ member: "" }).member, null);
});

test("the first value wins when a parameter repeats, and page counts stay in bounds", () => {
  assert.equal(parseAlbumFilters({ q: ["lake", "goose"] }).q, "lake");
  assert.equal(parseAlbumFilters({ pages: "0" }).pages, 1);
  assert.equal(parseAlbumFilters({ pages: "-4" }).pages, 1);
  assert.equal(parseAlbumFilters({ pages: "nope" }).pages, 1);
  assert.equal(parseAlbumFilters({ pages: "9999" }).pages, ALBUM_MAX_PAGES);
  assert.equal(parseAlbumFilters({ q: "x".repeat(500) }).q.length, 80);
});

test("a search is every word, lower-cased, a handful at most", () => {
  assert.deepEqual(searchTerms(""), []);
  assert.deepEqual(searchTerms("Goose  TOWPATH"), ["goose", "towpath"]);
  assert.equal(searchTerms("a b c d e f g h").length, 6);
});

test("typed percent signs and underscores are literal in a search", () => {
  assert.equal(escapeLike("100%_sure\\"), "100\\%\\_sure\\\\");
  assert.equal(escapeLike("plain"), "plain");
});

test("album links carry only the filters in play, and the viewer's token", () => {
  assert.equal(albumHref({ base: "/g/1/album" }), "/g/1/album");
  assert.equal(albumHref({ base: "/album/1", token: "abc" }), "/album/1?m=abc");
  assert.equal(
    albumHref({ base: "/album/1", token: "abc", member: ID, q: "lake swim", pages: 2 }),
    `/album/1?m=abc&member=${ID}&q=lake+swim&pages=2`,
  );
  assert.equal(albumHref({ base: "/a", pages: 1 }), "/a");
});

test("view-in-issue links land on the answer, token intact", () => {
  assert.equal(issueAnchor("answer-9", "issue-1"), "/i/issue-1#answer-9");
  assert.equal(issueAnchor("section-reply-2", "issue-1", "t/k"), "/i/issue-1?m=t%2Fk#section-reply-2");
});
