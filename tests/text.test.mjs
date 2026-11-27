// assets/text.js の hasName（名前がそのまま出てくる記事を探すときの決まり）のテスト
import { test } from "node:test";
import assert from "node:assert/strict";
import { norm, hasName } from "../assets/text.js";

const has = (text, name) => hasName(norm(text), norm(name));

test("ふつうに入っていれば見つかる", () => {
  assert.equal(has("アルバム「人間開花」を語る", "人間開花"), true);
  assert.equal(has("RADWIMPS 4〜おかずのごはん〜 の話", "RADWIMPS 4〜おかずのごはん〜"), true);
  assert.equal(has("RADWIMPS 2 の頃", "RADWIMPS 2"), true);
});

test("数字で終わる名前のすぐあとに数字・英字が続くときは数えない", () => {
  assert.equal(has("RADWIMPS 20th ANNIVERSARY LIVE TOUR", "RADWIMPS 2"), false);
  assert.equal(has("RADWIMPS 2015 Asia-Europe Live Tour", "RADWIMPS 2"), false);
  assert.equal(has("RADWIMPS、2000人の前で", "RADWIMPS 2"), false);
  assert.equal(has("RADWIMPS 4Eva song", "RADWIMPS 4"), false);
});

test("数字で始まる名前のすぐ前に数字があるときは数えない", () => {
  assert.equal(has("20184645（2018 よろしく）", "4645"), false);
  assert.equal(has("新曲「4645」", "4645"), true);
});

test("同じ名前が2回出てくるときは、条件に合うほうで見つかる", () => {
  assert.equal(has("RADWIMPS 20th と RADWIMPS 2 の話", "RADWIMPS 2"), true);
});
