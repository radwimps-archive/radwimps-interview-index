// tests/html.test.mjs
// HTML のページが、安全のための決まり（CSP）を守っているかを確かめます（node --test で動きます）。
// CSP があると、HTML の中に直接書いたプログラム（<script>…</script>）・style="…"・onclick="…" などは動きません。
// ここで止まったときは、その部分を assets フォルダの js・css ファイルに移してください。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PAGES = ["index.html", "history.html", "songs.html", "members.html", "maker.html", "404.html"];
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/<!--[\s\S]*?-->/g, "");

for (const page of PAGES) {
  test(`${page}：CSP が書かれている`, () => {
    const m = read(page).match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
    assert.ok(m, "CSP の <meta> がありません");
    assert.match(m[1], /script-src 'self'( https:\/\/static\.cloudflareinsights\.com)?(;|$)/, "script-src は 'self'（とアクセス集計の Cloudflare）だけにします");
    assert.doesNotMatch(m[1], /unsafe-inline|unsafe-eval/, "unsafe-inline・unsafe-eval は使いません");
  });
  test(`${page}：HTML の中に直接プログラムや style を書いていない`, () => {
    const html = read(page);
    for (const tag of html.match(/<script\b[^>]*>/g) || []) assert.match(tag, /\bsrc="/, `中身を直接書いた <script> があります：${tag}`);
    assert.doesNotMatch(html, /<style\b/, "<style> は assets の css に移してください");
    assert.doesNotMatch(html, /\sstyle="/, "style=\"…\" は assets の css に移してください");
    assert.doesNotMatch(html, /\son[a-z]+="/, "onclick=\"…\" などは assets の js に移してください");
    assert.doesNotMatch(html, /href="javascript:/i, "javascript: のリンクは使いません");
  });
}

test("公開のときに 404.html もコピーされる", () => {
  assert.match(read(".github/workflows/deploy.yml"), /cp -r [^\n]*404\.html/);
});
