import test from "node:test";
import assert from "node:assert/strict";
import { fold, skeleton, looseMatch, looseMatchAll } from "../assets/search.js";

test("fold：全角半角・大文字小文字・ひらがなカタカナ・記号をそろえる", () => {
  assert.equal(fold("ＲＡＤＷＩＭＰＳ Tour"), "radwimpstour");
  assert.equal(fold("ユーリンチー"), "ゆりんち");
  assert.equal(fold("「ゆーりんちー」"), "ゆりんち");
});

test("looseMatch：表記のゆれに合う", () => {
  assert.ok(looseMatch("Official Fan Club Tour 2026「ユーリンチー」", "ゆーりんちー"));
  assert.ok(looseMatch("Official Fan Club Tour 2026「ユーリンチー」", "official fan"));
  assert.ok(looseMatch("ROCK IN JAPAN FESTIVAL 2023", "rockinjapan"));
});

test("looseMatch：英名をひらがなで入れても合う", () => {
  assert.ok(looseMatch("FOREVER IN THE DAZE TOUR 2021-2022", "ふぉーえばー"));
  assert.ok(looseMatchAll("FOREVER IN THE DAZE TOUR 2021-2022", "でいず つあー"));
  assert.ok(looseMatch("RADWIMPS 15th Anniversary Special Concert", "あにばーさりー"));
  assert.ok(looseMatchAll("ROCK IN JAPAN FESTIVAL 2023", "ろっく いん じゃぱん"));
  assert.ok(looseMatch("Human Bloom Tour 2017", "ひゅーまんぶるーむ"));
  assert.ok(looseMatchAll("illion Japan Tour 2016", "いりおん"));
});

test("looseMatch：合わないものには合わない", () => {
  assert.ok(!looseMatch("ROCK IN JAPAN FESTIVAL 2023", "ゆーりんちー"));
  assert.ok(!looseMatch("RADWIMPS TOUR 2007「春巻き」", "でいず"));
  assert.ok(!looseMatch("有心論", "夢番地"));
});

test("looseMatchAll：空白で分けた言葉が全部合うとき", () => {
  assert.ok(looseMatchAll("FOREVER IN THE DAZE TOUR 2021-2022 横浜アリーナ", "ふぉーえばー 横浜"));
  assert.ok(!looseMatchAll("FOREVER IN THE DAZE TOUR 2021-2022 横浜アリーナ", "ふぉーえばー 大阪"));
  assert.ok(looseMatchAll("anything", ""));
});

test("skeleton：英語とひらがなを同じ子音の形にする", () => {
  assert.equal(skeleton("DAZE"), skeleton("でいず"));
  assert.equal(skeleton("FOREVER"), skeleton("ふぉーえばー"));
});
