// tests/html.test.mjs
// HTML のページが、安全のための決まり（CSP）を守っているかを確かめます（node --test で動きます）。
// CSP があると、HTML の中に直接書いたプログラム（<script>…</script>）・style="…"・onclick="…" などは動きません。
// ここで止まったときは、その部分を assets フォルダの js・css ファイルに移してください。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PAGES = ["index.html", "history.html", "members.html", "setlist.html", "maker.html", "404.html"];
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

test("tools/build.sh：すべてのページ（404.html も）をまとめ、読み込む js・css に版の番号を付ける。closing.html は公開しない", () => {
  const out = mkdtempSync(join(tmpdir(), "build-"));
  try {
    execFileSync("sh", ["tools/build.sh"], { cwd: new URL("../", import.meta.url), env: { ...process.env, OUT: out, GITHUB_SHA: "abcdef1234567890" }, stdio: "pipe" });
    const built = readdirSync(out).filter((f) => f.endsWith(".html")).sort();
    assert.deepEqual(built, [...PAGES].sort());
    for (const f of built) {
      const html = readFileSync(join(out, f), "utf8");
      for (const m of html.matchAll(/assets\/[\w-]+\.(js|css)(\?v=\w+)?"/g)) assert.equal(m[2], "?v=abcdef12", `${f}：${m[0]} に版の番号がない`);
    }
    assert.match(readFileSync(join(out, "assets/songs.js"), "utf8"), /"\.\/room-articles\.js\?v=abcdef12"/, "ハイフン入りの名前にも付く");
  } finally { rmSync(out, { recursive: true, force: true }); }
  assert.match(read(".github/workflows/deploy.yml"), /sh tools\/build\.sh/, "GitHub Pages の公開でも同じものを使う");
});

test("ページの一覧（PAGES）が、いちばん上の階層の .html と同じ（足したページがテストから漏れないように。closing.html は公開しないので除く）", () => {
  const files = readdirSync(new URL("../", import.meta.url)).filter((f) => f.endsWith(".html") && f !== "closing.html").sort();
  assert.deepEqual([...PAGES].sort(), files);
});
