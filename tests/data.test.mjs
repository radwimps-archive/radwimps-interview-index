// tests/data.test.mjs
// assets/data.js（CSV の読み取り）のテストです。プログラムを直したときに、読み取りが変わっていないかを確かめます。
// ・GitHub に変更を保存すると、サイトを公開する前に自動で実行されます（失敗すると公開を止めます）。
// ・自分のパソコンで動かす場合（Node.js が必要。追加のインストールは不要）：
//     node --test
// ※ データ（data フォルダの CSV）の書き間違いは、ここではなく tools/validate.mjs がチェックします。

import test from "node:test";
import assert from "node:assert/strict";
import { parseCSV, youtubeId, parseVideos, parseHistory, parseArticles, toCSVLine } from "../assets/data.js";

const HISTORY_HEAD = "年,月,日,終了年,終了月,終了日,カテゴリ,出来事,補足,特設サイト,タワーレコード,動画";
const history = (...rows) => parseHistory([HISTORY_HEAD, ...rows].join("\n"));

test("parseCSV：BOM・引用符・項目の中の改行と、行番号", () => {
  const { rows, lines, unclosedQuote } = parseCSV('﻿a,b\n"x, y","1行目\n2行目"\n"say ""hi""",z\n');
  assert.deepEqual(rows, [["a", "b"], ["x, y", "1行目\n2行目"], ['say "hi"', "z"]]);
  assert.deepEqual(lines, [1, 2, 4]);
  assert.equal(unclosedQuote, false);
  assert.equal(parseCSV('a,"b\n').unclosedQuote, true);
});

test("toCSVLine：カンマや引用符を含む項目を囲む", () => {
  assert.equal(toCSVLine(["a", "b,c", 'd"e', ""]), 'a,"b,c","d""e",');
});

test("youtubeId：いろいろな形の URL から、動画の id を取り出す", () => {
  const id = "XRnX65LDRoU";
  for (const url of [
    `https://www.youtube.com/watch?v=${id}`, `https://youtube.com/watch?v=${id}&t=30s`, `https://m.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}`, `https://youtu.be/${id}?si=abc`, `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`, `https://www.youtube-nocookie.com/embed/${id}`, `https://www.youtube.com/live/${id}`
  ]) assert.equal(youtubeId(url), id, url);
});

test("youtubeId：YouTube の動画でないものは null", () => {
  for (const v of ["", "https://example.com/watch?v=XRnX65LDRoU", "https://www.youtube.com/@radwimps", "https://youtu.be/short", "not a url"]) {
    assert.equal(youtubeId(v), null, v);
  }
  // id だけの書き方は、allowId を付けたときだけ受け付ける（記事の URL 欄では受け付けない）
  assert.equal(youtubeId("XRnX65LDRoU"), null);
  assert.equal(youtubeId("XRnX65LDRoU", { allowId: true }), "XRnX65LDRoU");
});

test("parseVideos：ラベルを省くと MV。読めない部分は bad に入る", () => {
  const { videos, bad } = parseVideos("XRnX65LDRoU | MV「光」=WuU6C8oXzIA | 予告編=https://www.youtube.com/watch?v=k4xGqY5IDBE | ライブ映像=abc");
  assert.deepEqual(videos, [
    { label: "MV", id: "XRnX65LDRoU" }, { label: "MV「光」", id: "WuU6C8oXzIA" }, { label: "予告編", id: "k4xGqY5IDBE" }
  ]);
  assert.deepEqual(bad, ["ライブ映像=abc"]);
  assert.deepEqual(parseVideos(""), { videos: [], bad: [] });
});

test("parseHistory：古い順に並べ、2つ以上のカテゴリを読む", () => {
  const r = history(
    "2016,8,26,,,,映画・タイアップ,映画公開,,https://www.kiminona.com/,,",
    "2015,9,23,,,,バンドの出来事、山口智史・VXD,休養を発表,,,,",
    "2015,,,,,,リリース,年だけの出来事,,,,",
    "2015,10,9,2015,10,23,ライブ・ツアー,ツアー,,,,MV=XRnX65LDRoU"
  );
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.events.map((e) => e.title), ["年だけの出来事", "休養を発表", "ツアー", "映画公開"]);
  const [, rest, tour, movie] = r.events;
  assert.deepEqual(rest.cats.map((c) => c.slug), ["band", "vxd"]);
  assert.deepEqual([tour.y, tour.m, tour.d, tour.ey, tour.em, tour.ed], [2015, 10, 9, 2015, 10, 23]);
  assert.deepEqual(tour.videos, [{ label: "MV", id: "XRnX65LDRoU" }]);
  assert.equal(movie.site, "https://www.kiminona.com/");
  assert.equal(rest.line, 3); // CSV の3行目
});

test("parseHistory：カテゴリの書き間違いはエラー（表示は「バンドの出来事」）、空欄は注意", () => {
  const r = history("2020,1,1,,,,バンドのできごと,まちがい,,,,", "2020,1,2,,,,,空欄,,,,");
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].msg, /カテゴリ「バンドのできごと」は使えません/);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0].msg, /カテゴリが空欄/);
  assert.deepEqual(r.events.map((e) => e.cats[0].slug), ["band", "band"]);
});

test("parseHistory：年や出来事がない行はエラーになり、年表に入らない", () => {
  const r = history(",5,1,,,,リリース,年がない,,,,", "2020,5,1,,,,リリース,,,,,", "2020,13,1,,,,リリース,月がおかしい,,,,");
  assert.equal(r.errors.length, 3);
  assert.equal(r.events.length, 0);
});

test("parseHistory：動画の書き間違いはエラー（出来事は残す）。リンクの書き間違いは注意", () => {
  const r = history(
    "2020,1,1,,,,リリース,動画まちがい,,,,MV=xyz",
    "2020,1,2,,,,リリース,サイトが http,,http://example.com/,,",
    "2020,1,3,,,,リリース,タワレコの列にほかのサイト,,,https://www.universal-music.co.jp/radwimps/,"
  );
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].msg, /動画「MV=xyz」の書き方が正しくありません/);
  assert.equal(r.warnings.length, 2);
  assert.equal(r.events.length, 3);
  assert.equal(r.events[1].site, ""); // https でないリンクは使わない
});

test("parseHistory：見出しに必要な列がないとエラー", () => {
  const r = parseHistory("年,月,日\n2020,1,1");
  assert.ok(r.errors.some((e) => /「出来事」の列がありません/.test(e.msg)));
  assert.equal(r.events.length, 0);
});

test("parseArticles：最小限の行を読み、YouTube の URL には種類の注意を出す", () => {
  const head = "状態,年,月,日,媒体,種類,カテゴリ,タイトル,URL";
  const r = parseArticles([head,
    "公開,2024,5,1,音楽ナタリー,インタビュー,,タイトルA,https://natalie.mu/music/interview/1",
    "公開,2024,5,2,YouTube,インタビュー,,タイトルB,https://www.youtube.com/watch?v=XRnX65LDRoU"
  ].join("\n"));
  assert.deepEqual(r.errors, []);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].format, "text");
  assert.ok(r.warnings.some((w) => w.line === 3 && /YouTube の URL です/.test(w.msg)));
});

test("parseArticles：見出しに必要な列がないとエラー", () => {
  const r = parseArticles("状態,年\n公開,2024");
  assert.ok(r.errors.some((e) => /「タイトル」の列がありません/.test(e.msg)));
});
