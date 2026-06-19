import assert from "node:assert/strict";
import { test } from "node:test";
import { attributePage, buildFinalePrompt, type PageShown } from "./finale";

test("attributePage: empty timeline falls back to page 1", () => {
  assert.equal(attributePage([], 1000), 1);
});

test("attributePage: a comment posted before the first page goes to the earliest page", () => {
  const timeline: PageShown[] = [
    { page: 2, shownAt: 1000 },
    { page: 3, shownAt: 2000 },
  ];
  assert.equal(attributePage(timeline, 500), 2);
});

test("attributePage: a post at the exact shownAt is attributed to that page", () => {
  const timeline: PageShown[] = [
    { page: 1, shownAt: 1000 },
    { page: 2, shownAt: 2000 },
  ];
  assert.equal(attributePage(timeline, 2000), 2);
});

test("attributePage: picks the last page shown at or before the post time", () => {
  const timeline: PageShown[] = [
    { page: 1, shownAt: 1000 },
    { page: 2, shownAt: 2000 },
    { page: 3, shownAt: 3000 },
  ];
  assert.equal(attributePage(timeline, 2500), 2);
  assert.equal(attributePage(timeline, 9000), 3);
});

test("buildFinalePrompt: tags each comment with its page and lays out the sections", () => {
  const prompt = buildFinalePrompt(
    [
      { text: "なるほど", page: 1 },
      { text: "すごい", page: 2 },
    ],
    ["表紙", "本論"],
  );
  assert.match(prompt, /^発表が終わりました。/);
  assert.ok(prompt.includes("# 指示"));
  assert.ok(prompt.includes("[p1] なるほど"));
  assert.ok(prompt.includes("[p2] すごい"));
  assert.ok(prompt.includes("## p1\n表紙"));
  assert.ok(prompt.includes("## p2\n本論"));
});

test("buildFinalePrompt: a page with no text gets the （テキストなし）fallback", () => {
  const prompt = buildFinalePrompt([{ text: "わかる", page: 1 }], ["", "   "]);
  assert.ok(prompt.includes("## p1\n（テキストなし）"));
  assert.ok(prompt.includes("## p2\n（テキストなし）"));
});
