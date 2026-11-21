// tests/encounter.test.mjs
// 玄関の「まだ読んでいない一節」の選び方を確かめます（node --test で動きます）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { todayKey, hashOf, candidatesOf, pickUnread } from "../assets/encounter.js";

const item = (id, extra = {}) => ({ id, state: "公開", summary: "紹介文", kind: "インタビュー", note: "", ...extra });

test("日付は日本時間で決まる（日本時間の0時で変わる）", () => {
  assert.equal(todayKey(new Date("2026-11-21T14:59:59Z")), "2026-11-21");
  assert.equal(todayKey(new Date("2026-11-21T15:00:00Z")), "2026-11-22");
});

test("同じ文字からは、いつも同じ番号", () => {
  assert.equal(hashOf("2026-11-21"), hashOf("2026-11-21"));
  assert.notEqual(hashOf("2026-11-21"), hashOf("2026-11-22"));
});

test("出せる記事：公開・紹介文あり・リリース情報と参考資料は除く。並びは id の順", () => {
  const list = candidatesOf([
    item("c"), item("a"), item("b", { state: "非表示" }), item("d", { summary: "" }),
    item("e", { kind: "リリース情報" }), item("f", { note: "参考資料：公式の記録" })
  ]);
  assert.deepEqual(list.map((x) => x.id), ["a", "c"]);
});

test("まだ読んでいない記事から選ぶ。全部読んでいたら null", () => {
  const list = candidatesOf([item("a"), item("b"), item("c")]);
  for (let d = 1; d <= 30; d++) {
    const it = pickUnread(list, new Set(["a", "c"]), `2026-11-${String(d).padStart(2, "0")}`);
    assert.equal(it.id, "b");
  }
  assert.equal(pickUnread(list, new Set(["a", "b", "c"]), "2026-11-21"), null);
});

test("初めての人（既読なし）には、日替わりの1本と同じ記事", () => {
  const list = candidatesOf([item("a"), item("b"), item("c"), item("d")]);
  const day = "2026-11-21";
  assert.equal(pickUnread(list, new Set(), day), list[hashOf(day) % list.length]);
});
