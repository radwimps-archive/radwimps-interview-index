// tests/data.test.mjs
// assets/data.js（CSV の読み取り）のテストです。プログラムを直したときに、読み取りが変わっていないかを確かめます。
// ・GitHub に変更を保存すると、サイトを公開する前に自動で実行されます（失敗すると公開を止めます）。
// ・自分のパソコンで動かす場合（Node.js が必要。追加のインストールは不要）：
//     node --test
// ※ データ（data フォルダの CSV）の書き間違いは、ここではなく tools/validate.mjs がチェックします。

import test from "node:test";
import assert from "node:assert/strict";
import { parseCSV, youtubeId, parseVideos, parseHistory, parseArticles, parseSetlists, splitSong, songKey, toCSVLine } from "../assets/data.js";

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

test("parseArticles：種類で、どのタブに出るかが決まる（ラジオは YouTube の URL でも注意を出さない）", () => {
  const head = "状態,年,月,日,媒体,種類,カテゴリ,タイトル,URL";
  const r = parseArticles([head,
    "公開,2025,11,15,TOKYO FM / YouTube,ラジオ,人物・素顔,ラジオの放送回,https://www.youtube.com/watch?v=pt_KQPp1MIc",
    "公開,2025,11,16,YouTube,動画,人物・素顔,動画,https://youtu.be/XRnX65LDRoU",
    "公開,2025,11,17,TOKYO FM,番組・会見,人物・素顔,放送の文字のレポート,https://www.tfm.co.jp/",
    "公開,2025,11,18,RADWIMPS公式,お知らせ,新作リリース,発売のお知らせ,https://radwimps.jp/"
  ].join("\n"));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.items.map((it) => [it.kind, it.format]), [["ラジオ", "radio"], ["動画", "video"], ["番組・会見", "text"], ["リリース情報", "release"]]);
});

test("parseArticles：見出しに必要な列がないとエラー", () => {
  const r = parseArticles("状態,年\n公開,2024");
  assert.ok(r.errors.some((e) => /「タイトル」の列がありません/.test(e.msg)));
});

const SETLIST_HEAD = "公演日,ライブ名,会場,本編,アンコール,ゲスト,確かさ,出典,出典URL,メモ";
const setlists = (...rows) => parseSetlists([SETLIST_HEAD, ...rows].join("\n"));

test("splitSong・songKey：曲名とメモを分け、同じ曲を同じ名前にする", () => {
  assert.deepEqual(splitSong("25コ目の染色体（アコースティック）"), { title: "25コ目の染色体", memo: "アコースティック" });
  assert.deepEqual(splitSong("05410-(ん)"), { title: "05410-(ん)", memo: "" });
  assert.equal(songKey("いいんですか？"), songKey("いいんですか?"));
  assert.equal(songKey("One man live"), songKey("one man  live"));
});

test("parseSetlists：曲の区切り・アンコール・並び順", () => {
  const { lives, errors, warnings } = setlists(
    "2019-08-29,B,横浜アリーナ,正解／DADA,有心論（with X）,あいみょん、Awich,確認済み,ぴあ,https://example.com/,",
    "2007-03,A,全国,ふたりごと,,,映像,生春巻き,,");
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.deepEqual(lives.map((l) => l.name), ["A", "B"]);
  assert.deepEqual(lives[1].main.map((s) => s.title), ["正解", "DADA"]);
  assert.deepEqual(lives[1].encore, [{ title: "有心論", memo: "with X" }]);
  assert.deepEqual(lives[1].guests, ["あいみょん", "Awich"]);
  assert.equal(lives[0].m, 3);
  assert.equal(lives[0].d, 0);
});

test("parseSetlists：【 】の見出しは、そのあとの曲を歌った人になる（曲には数えない）", () => {
  const { lives, errors } = setlists("2024-09-27,A,会場,【kZm】／Aquarius Heaven／【野田洋次郎】／SHEETA／PIPE DREAM,,,一部,出典,https://example.com/,");
  assert.deepEqual(errors, []);
  assert.deepEqual(lives[0].main.map((s) => [s.title, s.part]), [["Aquarius Heaven", "kZm"], ["SHEETA", "野田洋次郎"], ["PIPE DREAM", "野田洋次郎"]]);
});

test("parseSetlists：書き間違いを知らせる", () => {
  const { lives, errors, warnings } = setlists(
    "2019-13-01,B,,DADA,,,確認済み,,https://example.com/,",
    "2019-08-29,C,,,,,確認済み,,https://example.com/,",
    "2019-08-29,D,,DADA,,,たぶん,,https://example.com/,",
    "2019-08-29,E,,DADA/有心論,,,未確認,,http://example.com/,");
  assert.equal(errors.length, 3);
  assert.equal(lives.length, 1);
  assert.equal(warnings.length, 3); // 半角の「/」・http の URL・URL が空になった
});

test("parseSetlists：区分（国内ツアー・海外ツアー・フェス・単発ライブ）", () => {
  const head = SETLIST_HEAD + ",区分";
  const { lives, warnings } = parseSetlists([head,
    "2019-08-29,A,,DADA,,,確認済み,,https://example.com/,,フェス",
    "2019-08-30,B,,DADA,,,確認済み,,https://example.com/,,ライブ"].join("\n"));
  assert.deepEqual(lives.map((l) => l.cat), ["フェス", ""]);
  assert.equal(warnings.length, 1);
});
