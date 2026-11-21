// tests/shelf.test.mjs
// 「あなたの棚」の分け方（人・曲や作品・年代・ライブ）を確かめます（node --test で動きます）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { groupArticles, groupLives, workMatch, personSelf, pickArticles, orderArticles } from "../assets/shelf-data.js";
import { loadMarks, setMark, STORE_MARKS } from "../assets/marks.js";

const item = (id, extra = {}) => ({ id, kind: "インタビュー", title: id, summary: "", tags: [], members: [], guests: [], date: "", eventName: "", eventDate: "", ...extra });

test("人ごと：1つの記事は「メンバー」欄の最初の人にだけ入る。対談相手のまとまりは作らない", () => {
  const g = groupArticles([
    item("a", { members: ["takeda"], date: "2020-01-01" }),
    item("b", { members: ["noda", "takeda"], guests: ["新海誠"], date: "2021-01-01" }),
    item("c", { members: ["noda"], date: "2022-01-01" })
  ], "person");
  assert.deepEqual(g.map((x) => x.name), ["野田洋次郎", "武田祐介"]);
  assert.equal(g.reduce((n, x) => n + x.items.length, 0), 3, "同じ記事が2回出ない");
  assert.deepEqual(g[0].items.map((x) => x.id), ["c", "b"], "新しい記事が上");
});

test("曲・作品ごと：映画と曲の両方にあてはまる記事は、曲のまとまりにだけ入る", () => {
  const g = groupArticles([item("a", { tags: ["余命10年", "うるうびと"] })], "work");
  assert.deepEqual(g.map((x) => x.name), ["うるうびと"]);
});

test("曲・作品ごと：タグや「」付きの曲名で入り、どれにも入らない記事は「そのほか」", () => {
  const g = groupArticles([
    item("a", { tags: ["前前前世"] }),
    item("b", { title: "新曲「そっけない」について" }),
    item("c", { title: "近況" })
  ], "work");
  assert.deepEqual(g.map((x) => x.name), ["そっけない", "前前前世", "そのほか"]);
});

test("曲名の一致：短い名前は「」付きのときだけ（「光」が別の言葉の中で一致しないように）", () => {
  assert.equal(workMatch(item("a", { title: "光の中で" }), "光"), false);
  assert.equal(workMatch(item("a", { title: "新曲「光」" }), "光"), true);
});

test("年代ごと：新しい年から。日付のない記事は「そのほか」", () => {
  const g = groupArticles([item("a", { date: "2019-05-01" }), item("b", { date: "2024-01-01" }), item("c")], "year");
  assert.deepEqual(g.map((x) => x.name), ["2024年", "2019年", "そのほか"]);
});

test("ライブごと：記事一覧の「ライブから探す」と同じく、ライブレポートだけ。公演日の新しいライブから", () => {
  const live = { kind: "ライブレポート" };
  const g = groupArticles([
    item("a", { ...live, eventName: "ツアーA", eventDate: "2018-01-01" }),
    item("b", { ...live, eventName: "ツアーB", eventDate: "2023-01-01" }),
    item("d", { ...live }),
    item("e", { kind: "番組・会見", eventName: "紅白", eventDate: "2024-12-31" }),
    item("c")
  ], "live");
  assert.deepEqual(g.map((x) => x.name), ["ツアーB", "ツアーA", "ライブ名を確認中", "ライブレポート以外"]);
});

test("参加した公演：ライブ名ごと。新しい公演のあるライブから、公演も新しい順", () => {
  const g = groupLives([
    { name: "ツアーA", date: "2018-01-01" }, { name: "ツアーB", date: "2023-02-01" }, { name: "ツアーA", date: "2018-03-01" }
  ]);
  assert.deepEqual(g.map((x) => x.name), ["ツアーB", "ツアーA"]);
  assert.deepEqual(g[1].items.map((x) => x.date), ["2018-03-01", "2018-01-01"]);
});

test("楽曲一覧・メンバー紹介の記事：公開中だけを新しい順に。日付のない記事は最後", () => {
  const list = pickArticles([
    item("a", { state: "公開", date: "2020-01-01" }),
    item("b", { state: "非表示", date: "2024-01-01" }),
    item("c", { state: "公開", date: "" }),
    item("d", { state: "公開", date: "2023-05-01" }),
    item("z", { state: "公開", date: "2020-01-01" }),
    item("e", { state: "公開", date: "2020-01-01" })
  ], () => true);
  assert.deepEqual(list.map((x) => x.id), ["d", "a", "z", "e", "c"], "同じ日付は CSV の順のまま（記事一覧と同じ）");
});

test("メンバー紹介の記事：記事一覧の ?person= と同じ「本人が語っている記事」（メンバーはメンバー欄、ほかの人は対談相手の欄）", () => {
  assert.equal(personSelf(item("a", { members: ["takeda"] }), "武田祐介"), true);
  assert.equal(personSelf(item("a", { members: ["noda"], tags: ["武田祐介"] }), "武田祐介"), false);
  assert.equal(personSelf(item("a", { members: ["band"] }), "RADWIMPS"), true);
  assert.equal(personSelf(item("a", { guests: ["森瑞希"] }), "森瑞希"), true);
});

test("印の読み書き：ほかの印を残したまま付け外しでき、以前の「お気に入り（★）」はあとで読むとして扱う", () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  try {
    store.set(STORE_MARKS, JSON.stringify({ rd: { x: 1 }, bm: { old: 1 } }));
    assert.deepEqual([...loadMarks().lt], ["old"]);
    assert.equal(setMark("fv", "a", true), true);
    let m = loadMarks();
    assert.ok(m.fv.has("a") && m.rd.has("x"), "既読は残る");
    setMark("lt", "old", false);
    assert.equal(loadMarks().lt.has("old"), false, "以前の★からも消える（記事一覧で戻らないように）");
  } finally { delete globalThis.localStorage; }
});

test("並び順：古い順でも日付のない記事は最後。同じ日付は CSV の順のまま。新しい順はそのまま", () => {
  const list = pickArticles([
    item("a", { state: "公開", date: "2020-01-01" }), item("c", { state: "公開", date: "" }),
    item("d", { state: "公開", date: "2023-05-01" }), item("z", { state: "公開", date: "2020-01-01" })
  ], () => true);
  assert.deepEqual(orderArticles(list, "old").map((x) => x.id), ["a", "z", "d", "c"]);
  assert.equal(orderArticles(list, "new"), list);
});
