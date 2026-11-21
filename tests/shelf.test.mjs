// tests/shelf.test.mjs
// 「あなたの棚」の分け方（人・曲や作品・年代・ライブ）を確かめます（node --test で動きます）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { groupArticles, groupLives, workMatch } from "../assets/shelf-data.js";

const item = (id, extra = {}) => ({ id, kind: "インタビュー", title: id, summary: "", tags: [], members: [], guests: [], date: "", eventName: "", eventDate: "", ...extra });

test("人ごと：メンバーの順に並び、対談相手は後ろ。1つの記事が2人に入ることもある", () => {
  const g = groupArticles([
    item("a", { members: ["takeda"], date: "2020-01-01" }),
    item("b", { members: ["noda"], guests: ["新海誠"], date: "2021-01-01" }),
    item("c", { members: ["noda"], date: "2022-01-01" })
  ], "person");
  assert.deepEqual(g.map((x) => x.name), ["野田洋次郎", "武田祐介", "新海誠"]);
  assert.deepEqual(g[0].items.map((x) => x.id), ["c", "b"], "新しい記事が上");
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
