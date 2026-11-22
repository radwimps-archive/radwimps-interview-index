// tests/history-search.test.mjs
// 「RADWIMPSの歩み」の検索窓で探す文字（data.js の historySearchText）と、ゆるい一致（search.js）を確かめます（node --test で動きます）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHistory, parseSites, attachSites, historySearchText, matchHistory } from "../assets/data.js";
import { looseMatchAll } from "../assets/search.js";

const HEAD = "年,月,日,終了年,終了月,終了日,カテゴリ,出来事,補足,特設サイト,タワーレコード,動画\n";
const SITE_HEAD = "状態,年,月,日,名前,種類,URL,公開終了,保存版URL,メモ,id\n";
const find = (events, q) => events.filter((e) => matchHistory(e, q, looseMatchAll)).map((e) => e.title);

const { events } = parseHistory(HEAD + [
  "2016,4,5,,,,ライブ・ツアー,全国ツアー「Human Bloom Tour 2016」開催,,,,",
  "2016,8,24,,,,リリース,7th Album「人間開花」リリース,,,RADWIMPS 人間開花,MV「光」=WuU6C8oXzIA",
  "2021,12,4,2022,1,30,ライブ・ツアー,全国アリーナツアー「RADWIMPS FOREVER IN THE DAZE TOUR 2021-2022」開催,,,,",
  "2023,11,1,,,,バンドの出来事,秋の出来事,1月27日に先行配信,,,",
].join("\n"));

test("ひらがなで英語の名前が見つかる（マニュアルの例：ふぉーえばー）", () => {
  assert.deepEqual(find(events, "ふぉーえばー"), [events[2].title]);
});

test("空白で区切ると、すべての言葉に合う出来事だけ（ツアー 2016）", () => {
  assert.deepEqual(find(events, "ツアー 2016"), [events[0].title]);
});

test("日付はいくつかの形で見つかる（2016年・4月・4月5日・2016年4月・終わりの年月）", () => {
  assert.deepEqual(find(events, "4月5日"), [events[0].title]);
  assert.deepEqual(find(events, "4月"), [events[0].title]);
  assert.deepEqual(find(events, "2016年4月"), [events[0].title]);
  assert.deepEqual(find(events, "０４月"), [events[0].title]); // 全角・0つきでも
  assert.deepEqual(find(events, "2022年"), [events[2].title]);
  assert.deepEqual(find(events, "ツアー 1月"), [events[2].title]); // 終わりの月（2022年1月）
});

test("「1月」は 11月・12月の出来事に合わない", () => {
  // 2022年1月30日に終わるツアーと、補足に「1月27日」と書いた行だけ（2023年11月1日という日付そのものには合わない）
  assert.deepEqual(find(events, "1月"), [events[2].title, events[3].title]);
  assert.deepEqual(find(events, "11月"), [events[3].title]);
  assert.deepEqual(find(events, "1月1日"), []);
  assert.deepEqual(find(events, "11月1日"), [events[3].title]);
});

test("動画のラベルで見つかる", () => {
  assert.deepEqual(find(events, "光"), [events[1].title]);
});

test("項目の境目をまたいだ言葉では合わない（見出しの終わり＋カテゴリ）", () => {
  assert.deepEqual(find(events, "リリースリリース"), []);
});

test("MV のタブの項目は、ボタンの文言（MV を見る）では合わない", () => {
  const mv = { y: 2016, m: 8, d: 24, title: "「光」", note: "7th Album「人間開花」リリース", cats: [{ name: "MV" }], videos: [{ label: "MV を見る", id: "x" }], mv: true };
  assert.equal(looseMatchAll(historySearchText(mv), "見る"), false);
  assert.equal(looseMatchAll(historySearchText(mv), "人間開花"), true);
});

test("特設サイトをつないだ後の出来事は、特設サイトの名前と「特設サイト」で見つかる", () => {
  const { sites } = parseSites(SITE_HEAD + "公開,2016,4,5,ひみつの特設ページ,ライブ・ツアー,https://example.jp/a/,,,,site-a\n");
  const out = attachSites(events, sites);
  assert.deepEqual(find(out, "ひみつの特設ページ"), ["「ひみつの特設ページ」の特設サイト"]);
  assert.ok(find(out, "特設サイト").includes("「ひみつの特設ページ」の特設サイト"));
  assert.deepEqual(find(events, "特設サイト"), []); // つなぐ前の出来事には入らない
});

test("今の data/history.csv：マニュアルの例が見つかる", () => {
  const all = parseHistory(readFileSync(new URL("../data/history.csv", import.meta.url), "utf8")).events;
  assert.ok(find(all, "ふぉーえばー").some((t) => t.includes("FOREVER IN THE DAZE TOUR")));
});

test("補足に書いた日付でも見つかる。前後が別の数字のときは合わない", () => {
  assert.deepEqual(find(events, "1月27日"), [events[3].title]);
  assert.deepEqual(find(events, "1月2日"), []); // 「1月27日」の途中では合わない
});

test("期間のある出来事は、途中の月でも見つかる（2021年12月〜2022年1月）", () => {
  const { events: ev } = parseHistory(HEAD + "2016,4,1,2016,7,31,ライブ・ツアー,長いツアー,,,,\n");
  assert.equal(find(ev, "5月").length, 1);
  assert.equal(find(ev, "2016年6月").length, 1);
  assert.equal(find(ev, "8月").length, 0);
  assert.deepEqual(find(events, "2021年12月"), [events[2].title]);
});

test("日付とほかの言葉を続けて入れても見つかる（ツアー4月・4月ツアー）", () => {
  assert.deepEqual(find(events, "ツアー4月"), [events[0].title]);
  assert.deepEqual(find(events, "4月ツアー"), [events[0].title]);
});

test("今の data/history.csv：補足の日付で見つかる（1月27日・10月7日）", () => {
  const all = parseHistory(readFileSync(new URL("../data/history.csv", import.meta.url), "utf8")).events;
  assert.ok(find(all, "1月27日").length >= 1);
  assert.ok(find(all, "10月7日").length >= 1);
});

test("年表の画面に出る日付の形（04.05・2016.04.05）でも見つかる", () => {
  assert.deepEqual(find(events, "04.05"), [events[0].title]);
  assert.deepEqual(find(events, "2016.4.5"), [events[0].title]);
  assert.deepEqual(find(events, "4.15"), []);
  assert.deepEqual(find(events, "13月"), []); // ありえない月日は、ふつうの言葉として探す（合う文字がないので0件）
  const { events: ev } = parseHistory(HEAD + "2020,1,1,,,,リリース,「Ver 2.0」リリース,,,,\n");
  assert.equal(find(ev, "2.0").length, 1);
});

test("作品名の中の「4.5」は、作品名でも点の形でも見つかる", () => {
  const { events: ev } = parseHistory(HEAD + "2010,12,1,,,,リリース,ミュージッククリップ集「RADWIMPS4.5」リリース,,,,\n2021,4,5,,,,リリース,別の曲の配信,,,,\n");
  assert.equal(find(ev, "RADWIMPS4.5").length, 1);
  assert.equal(find(ev, "4.5").length, 2); // 4月5日の行と、作品名に 4.5 がある行
  assert.equal(find(ev, "4月5日").length, 1); // 月の形は、ぴったり比べる
});
