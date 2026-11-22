// tests/check-links.test.mjs
// リンク切れチェック（tools/check-links.mjs）の「中身が記事と合っているか」の判定を確かめます（node --test で動きます）。
// 実際のサイトにはアクセスしません（fetch を作りものに差し替えます）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { articleTerms, contentMatch, checkUrl, checkAll, buildReport, MIN_TEXT, parseSiteRows, siteTerms } from "../tools/check-links.mjs";

const article = { title: "RADWIMPS 『絶体絶命』", members: ["noda", "yamaguchi"], guests: [], tags: ["#絶体絶命", "#DADA"] };
const filler = "ご利用のお客様へ大切なお知らせです。".repeat(30); // MIN_TEXT より長い、記事と関係のない文
const page = (title, body) => `<html><head><title>${title}</title></head><body><h1>${title}</h1><p>${body}</p><script>var RADWIMPS = 1;</script></body></html>`;
const fakeFetch = (html, status = 200) => async () => new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });

test("記事の言葉：RADWIMPS・メンバーの名前（ローマ字も）・『』の作品名・タグが入る。手がかりにならない言葉は入れない", () => {
  const t = articleTerms(article).map((x) => x.show);
  for (const w of ["RADWIMPS", "野田洋次郎", "洋次郎", "yojiro noda", "山口智史", "絶体絶命", "DADA"]) assert.ok(t.includes(w), w);
  assert.equal(t.at(-1), "ラッドウィンプス", "RADWIMPS はお知らせの手がかりにならないので最後");
  assert.equal(articleTerms(article)[0].show, "野田洋次郎");
  const none = articleTerms({ title: "", tags: ["#光", "#PR", "#311", "#CM", "#映画", "#タイアップ", "#10周年", "#ワールドツアー"] }).map((x) => x.show);
  assert.deepEqual(none, ["RADWIMPS", "ラッドウィンプス"], "1文字・短い英数字・数字・よくあるタグは入れない");
});

test("中身の判定：記事の言葉があれば found。プログラムの中（<script>）の言葉は数えない", () => {
  const terms = articleTerms(article);
  assert.equal(contentMatch(page("RADWIMPS インタビュー", filler), terms).verdict, "found");
  assert.equal(contentMatch(page("ぜったいぜつめい", filler), articleTerms({ title: "", tags: ["ゼッタイゼツメイ"] })).verdict, "found", "ひらがなとカタカナの違いは気にしない");
  assert.equal(contentMatch(page("個人情報の漏えいに関するお知らせ", filler), terms).verdict, "missing");
  assert.ok(filler.length >= MIN_TEXT);
  assert.equal(contentMatch(page("", ""), terms).verdict, "unknown", "文字が少ないページ（画面をプログラムで作るサイトなど）は判断しない");
  assert.equal(contentMatch(`<html><head><meta property="og:title" content="RADWIMPS 特集"></head><body>${filler}</body></html>`, terms).verdict, "found", "題名の meta（og:title）も見る");
  assert.equal(contentMatch(`<html><head><meta property="og:title" content="Yojiro Noda's new album"></head><body>${filler}</body></html>`, terms).verdict, "found", "英語の題名（アポストロフィ入り）とローマ字の名前");
  assert.equal(contentMatch(`<html><body>${filler}<script type="application/ld+json">{"headline":"RADWIMPS 絶体絶命"}</script></body></html>`, terms).verdict, "found", "記事の情報を JSON で持つページ");
  assert.equal(contentMatch(`<html><body>${filler}<script>var a = "${filler}`, terms).verdict, "missing", "途中で切れた script の中身は本文に数えない");
  assert.equal(contentMatch(page("お知らせ", filler), terms, { cut: true }).verdict, "unknown", "最後まで読めなかったページは言い切らない");
});

test("中身が違うときは1回だけ確かめ直し、2回目に記事が出れば問題なしにする（一時的なメンテナンス画面など）", async () => {
  let n = 0;
  const pages = [page("ただいまメンテナンス中です", filler), page("RADWIMPS『絶体絶命』インタビュー", filler)];
  const fetch = async () => new Response(pages[Math.min(n++, 1)], { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  const [r] = await checkAll([{ ...article, url: "https://example.com/a" }], { fetch, retryDelayMs: 0, hostGapMs: 0 });
  assert.equal(r.level, "ok");
  assert.equal(n, 2);
  let m = 0;
  const fetch2 = async () => { m++; return new Response(pages[0], { status: 200, headers: { "content-type": "text/html" } }); };
  const [r2] = await checkAll([{ ...article, url: "https://example.com/a" }], { fetch: fetch2, retryDelayMs: 0, hostGapMs: 0 });
  assert.equal(r2.level, "mismatch");
  assert.equal(m, 2);
  assert.match(r2.reason, /野田洋次郎/, "お知らせには元の書き方の言葉を出す");
});

test("1件の確認：記事の言葉がない別のページに差し替わっていたら「中身が違う可能性」、文字が少なければ「要確認」", async () => {
  const expect = articleTerms(article);
  const r1 = await checkUrl("https://example.com/a", { fetch: fakeFetch(page("個人情報の漏えいに関するお知らせ", filler)), expect });
  assert.equal(r1.level, "mismatch");
  assert.match(r1.reason, /個人情報の漏えいに関するお知らせ/);
  const r2 = await checkUrl("https://example.com/a", { fetch: fakeFetch(page("RADWIMPS『絶体絶命』インタビュー", filler)), expect });
  assert.equal(r2.level, "ok");
  const r3 = await checkUrl("https://example.com/a", { fetch: fakeFetch("<html><body><div id=app></div></body></html>"), expect });
  assert.equal(r3.level, "warn");
  const r4 = await checkUrl("https://example.com/a", { fetch: fakeFetch(page("お知らせ", filler)) });
  assert.equal(r4.level, "ok", "記事の言葉を渡さないときは、今までどおり中身は見ない");
});

test("お知らせ文：中身が違う可能性のある記事は「対応が必要」に数え、リンク切れの記事は「開けるようになった」に入れない", () => {
  const it = (state) => ({ line: 2, date: "2011-03-04", media: "TOWER RECORDS ONLINE", title: "RADWIMPS 『絶体絶命』", url: "https://example.com/a", state });
  const r = { level: "mismatch", reason: "記事の言葉がページに見当たりません" };
  const a = buildReport([{ it: it("公開"), r }], "2026年11月21日");
  assert.equal(a.problems, 1);
  assert.match(a.markdown, /中身が記事と違う可能性がある記事（1 件）/);
  const b = buildReport([{ it: it("リンク切れ"), r }], "2026年11月21日");
  assert.equal(b.problems, 0);
  assert.doesNotMatch(b.markdown, /開けるようになった/);
});

const SITES = `状態,年,月,日,名前,種類,URL,公開終了,保存版URL,メモ,id
公開,2025,11,19,Dear Jubilee -RADWIMPS TRIBUTE-,作品,https://example.com/dj/,,https://web.archive.org/web/1/https://example.com/dj/,日付：発売日,site-dj
公開,2015,6,6,トイレのピエタ,映画・ドラマ,http://example.com/toilet/,終了,https://web.archive.org/web/2/http://example.com/toilet/,,site-toilet
非表示,2010,1,1,昔のサイト,作品,https://example.com/old/,,,,site-old
公開,2012,1,1,保存版のない終了サイト,作品,https://example.com/x/,終了,,,site-x
`;

test("特設サイト：公開中は本来の URL を、公開終了は保存版を確かめる（保存版がない終了サイトは確かめない）", () => {
  const rows = parseSiteRows(SITES);
  assert.deepEqual(rows.map((r) => [r.title, r.url, r.closed]), [
    ["Dear Jubilee -RADWIMPS TRIBUTE-", "https://example.com/dj/", false],
    ["トイレのピエタ", "https://web.archive.org/web/2/http://example.com/toilet/", true],
    ["昔のサイト", "https://example.com/old/", false]
  ]);
  assert.equal(rows[0].line, 2);
  assert.equal(rows[0].date, "2025-11-19");
  assert.equal(rows[2].state, "非表示");
});

test("特設サイトの言葉：名前とその一部（Dear Jubilee の Jubilee など）・RADWIMPS・野田洋次郎。短い英字やよくある言葉は入れない", () => {
  const keys = siteTerms({ title: "Dear Jubilee -RADWIMPS TRIBUTE-" }).map((t) => t.show);
  for (const w of ["Dear Jubilee -RADWIMPS TRIBUTE-", "Jubilee", "TRIBUTE", "RADWIMPS", "野田洋次郎"]) assert.ok(keys.includes(w), w);
  const tour = siteTerms({ title: "FOREVER IN THE DAZE TOUR" }).map((t) => t.show);
  for (const w of ["IN", "THE", "TOUR"]) assert.ok(!tour.includes(w), `${w}：短い英字・よくある言葉は入れない`);
  assert.ok(tour.includes("FOREVER"));
});

test("お知らせ文：公開が終わった可能性のある特設サイトと、開けない保存版は「対応が必要」。非表示のサイトは数えない", () => {
  const [open, closed, hidden] = parseSiteRows(SITES);
  const a = buildReport([
    { it: open, r: { level: "dead", reason: "ページが見つかりません（404）" } },
    { it: closed, r: { level: "dead", reason: "ページが見つかりません（404）" } },
    { it: hidden, r: { level: "dead", reason: "ページが見つかりません（404）" } }
  ], "2026年11月22日");
  assert.equal(a.problems, 2);
  assert.match(a.markdown, /公開が終わった可能性がある特設サイト（1 件）/);
  assert.match(a.markdown, /保存版が開けない特設サイト（1 件）/);
  assert.match(a.markdown, /特設サイト（data\/sites\.csv）2 件も確かめました/);
  const b = buildReport([{ it: open, r: { level: "ok", reason: "" } }], "2026年11月22日");
  assert.equal(b.problems, 0);
  assert.match(b.markdown, /対応が必要な記事はありませんでした/);
});
