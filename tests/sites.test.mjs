// tests/sites.test.mjs
// 特設サイトの一覧（data/sites.csv）の読み取りと、年表へのつなぎこみを確かめます（node --test で動きます）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseSites, attachSites, parseHistory } from "../assets/data.js";

const HEAD = "状態,年,月,日,名前,種類,URL,公開終了,保存版URL,メモ,id\n";

test("今の data/sites.csv はエラーなく読める", () => {
  const { errors } = parseSites(readFileSync(new URL("../data/sites.csv", import.meta.url), "utf8"));
  assert.deepEqual(errors, []);
});

test("書き間違い：種類・URL・公開終了・保存版URL", () => {
  const { errors } = parseSites(HEAD + "公開,2020,1,1,A,ライブ,http://a.jp/,おわり,https://example.com/,,\n");
  assert.equal(errors.length, 4);
});

test("公開終了なのに保存版がないときは「注意」", () => {
  const { errors, warnings } = parseSites(HEAD + "公開,2011,3,,糸色,その他,https://itoshiki.info/,終了,,,\n");
  assert.equal(errors.length, 0);
  assert.equal(warnings.length, 1);
});

test("年表へのつなぎこみ：同じ URL、同じ日付と名前、どちらもなければ1行足す", () => {
  const history = parseHistory("年,月,日,終了年,終了月,終了日,カテゴリ,出来事,補足,特設サイト,タワーレコード,動画\n"
    + "2021,12,4,,,,ライブ・ツアー,ツアー「X TOUR」開催,,https://www.radwimps.jp/x/,,\n"
    + "2025,11,19,,,,リリース,アルバム「Dear Jubilee -RADWIMPS TRIBUTE-」リリース,,,Dear Jubilee,\n").events;
  const sites = parseSites(HEAD
    + "公開,2021,12,4,X TOUR,ライブ・ツアー,https://radwimps.jp/x,,,,\n"
    + "公開,2025,11,19,Dear Jubilee -RADWIMPS TRIBUTE-,作品,https://example.jp/dj/,,,,\n"
    + "公開,2011,3,25,糸色,その他,https://itoshiki.info/,,,,\n"
    + "非表示,2012,1,1,隠す,その他,https://example.jp/h/,,,,\n").sites;
  const out = attachSites(history, sites);
  assert.equal(out.length, 3, "糸色だけが新しい行。非表示は出さない");
  assert.equal(out[0].title, "「糸色」の特設サイト");
  assert.equal(out[0].cats[0].name, "バンドの出来事");
  assert.equal(out[1].sites[0].name, "X TOUR", "https・www・最後の / のちがいは気にしない");
  assert.equal(out[2].sites[0].name, "Dear Jubilee -RADWIMPS TRIBUTE-");
});
