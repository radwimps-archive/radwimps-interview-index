#!/usr/bin/env node
// tools/check-links.mjs
// 記事のリンクが今も開けるかを確かめます。
//
// ・GitHub Actions から毎週月曜に自動で実行され、対応が必要な記事があれば GitHub の Issue でお知らせします。
// ・自分のパソコンで実行する場合（Node.js が必要）：
//     node tools/check-links.mjs                 … 結果を画面に表示
//     node tools/check-links.mjs --report 結果.md … 結果をファイルにも書き出す
//
// 判定のしかた
//   ✗ リンク切れの可能性が高い … ページが見つからない（404・410）、サイト自体がなくなっている、
//                               別のサイトやトップページに転送される、「ページが見つかりません」と表示される
//   △ 要確認 …………………… アクセスを断られた（403 など）、応答がない、サーバーの一時的なエラー
//                               （自動チェックを断るサイトもあるので、人が開いて確かめます）
//   ✓ 問題なし
//
// チェックしない記事
//   ・状態が「非表示」の記事
//   ・メモ列に「リンク確認不要」と書いた記事（毎回まちがって引っかかる記事に使います）
//   状態が「リンク切れ」の記事もチェックし、開けるようになっていればお知らせします。

import { readFile, writeFile, appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArticles, youtubeId } from "../assets/data.js";
export { youtubeId };

const DEFAULTS = {
  fetch: (...args) => fetch(...args),
  timeoutMs: 20000,       // 1回の確認で待つ時間
  concurrency: 4,         // 同時に確かめる数
  hostGapMs: 1500,        // 同じサイトに続けてアクセスするときの間隔（相手のサイトに負担をかけないため）
  retryDelayMs: 5000,     // 一時的なエラーのとき、もう一度試すまでの時間
  oembedBase: "https://www.youtube.com/oembed"
};

const repo = process.env.GITHUB_REPOSITORY ? `https://github.com/${process.env.GITHUB_REPOSITORY}` : "https://github.com/";
const HEADERS = {
  "User-Agent": `Mozilla/5.0 (compatible; RadwimpsInterviewIndexLinkCheck/1.0; +${repo})`,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en;q=0.8"
};

// ページの題名や見出しにこれが出ていたら「見つからないページ」とみなす
const NOT_FOUND = [
  /ページが見つかりません/, /ページは見つかりませんでした/, /お探しのページ/, /指定されたページ/, /存在しません/,
  /公開(を|は)?終了/, /掲載(を|は)?終了/, /掲載期間/, /配信(を|は)?終了/, /削除されました/,
  /not\s*found/i, /\b404\b/, /page (doesn['’]t|does not) exist/i, /no longer available/i, /video unavailable/i
];

// 「co.jp」のように2つで1組の末尾（サイトの見分けに使う）
const TWO_LEVEL = new Set(["co.jp", "ne.jp", "or.jp", "ac.jp", "go.jp", "gr.jp", "ed.jp", "lg.jp", "ad.jp",
  "co.uk", "org.uk", "ac.uk", "co.kr", "or.kr", "com.au", "net.au", "org.au", "co.nz", "com.br", "com.cn",
  "com.tw", "com.hk", "com.sg", "com.mx", "com.ar", "co.id", "co.th", "com.my", "com.ph"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dead = (reason) => ({ level: "dead", reason });
const warn = (reason, retry = false) => ({ level: "warn", reason, retry });

/* ---------- 判定に使う小さな関数 ---------- */

// サイトの「本体」の名前（news.walkerplus.com と www.walkerplus.com は同じサイト、とみなすため）
export function registrableDomain(host) {
  host = String(host).toLowerCase().replace(/\.$/, "");
  if (/^[\d.]+$/.test(host) || host.includes(":")) return host;
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  return TWO_LEVEL.has(parts.slice(-2).join(".")) ? parts.slice(-3).join(".") : parts.slice(-2).join(".");
}

// 転送のされ方を調べる：別のサイト／トップページ／上の階層（一覧など）
export function describeMove(from, to) {
  if (from === to) return null;
  let a, b;
  try { a = new URL(from); b = new URL(to); } catch { return null; }
  if (registrableDomain(a.hostname) !== registrableDomain(b.hostname)) return { type: "other-site", host: b.hostname };
  const isRoot = (p) => p === "/" || /^\/index\.(html?|php)$/i.test(p);
  const pa = a.pathname.replace(/\/+$/, "") || "/", pb = b.pathname.replace(/\/+$/, "") || "/";
  if (!isRoot(pa) && isRoot(pb)) return { type: "top" };
  const sa = pa.split("/").filter(Boolean), sb = pb.split("/").filter(Boolean);
  if (sb.length < sa.length && sa.slice(0, sb.length).join("/") === sb.join("/")) return { type: "upper" };
  return null;
}

function decodeEntities(s) {
  return s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

// ページの題名（<title>）と最初の大見出し（<h1>）を取り出す
export function pageTitle(html) {
  const pick = (re) => { const m = html.match(re); return m ? decodeEntities(m[1].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim() : ""; };
  return [pick(/<title[^>]*>([\s\S]*?)<\/title>/i), pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i)].filter(Boolean).join(" ／ ");
}

// 本文の先頭だけ読む（文字コードは Content-Type か <meta charset> から判断）
async function readSome(res, limit) {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  let charset = (res.headers.get("content-type") || "").match(/charset=["']?([\w-]+)/i)?.[1];
  if (!charset) charset = buf.subarray(0, 4096).toString("latin1").match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  try { return new TextDecoder(charset || "utf-8").decode(buf); } catch { return new TextDecoder("utf-8").decode(buf); }
}

function networkResult(e) {
  if (e && (e.name === "TimeoutError" || e.name === "AbortError")) return warn("時間内に応答がありませんでした", true);
  const code = (e && (e.cause?.code || e.code)) || "";
  if (code === "ENOTFOUND") return dead("サイトの住所（ドメイン）が見つかりません");
  if (code === "EAI_AGAIN") return warn("サイトの住所を一時的に調べられませんでした", true);
  if (code === "ECONNREFUSED") return warn("接続を断られました", true);
  if (/CERT|SSL|TLS/i.test(code)) return warn("安全な接続（証明書）に問題があります");
  return warn(`接続できませんでした（${code || (e && e.message) || "原因不明"}）`, true);
}

/* ---------- 1件を確かめる ---------- */

async function checkYouTube(id, o) {
  const target = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  try {
    const res = await o.fetch(`${o.oembedBase}?format=json&url=${encodeURIComponent(target)}`, { headers: HEADERS, signal: AbortSignal.timeout(o.timeoutMs) });
    if (res.ok) {
      const j = await res.json().catch(() => ({}));
      return { level: "ok", reason: "", title: j.title || "" };
    }
    await res.body?.cancel().catch(() => {});
    if (res.status === 404 || res.status === 400) return dead("動画が削除されたか、見つかりません");
    if (res.status === 401 || res.status === 403) return warn("動画が非公開か、ほかのサイトでの表示が禁止されています");
    return warn(`動画の情報を確かめられませんでした（${res.status}）`, res.status >= 500 || res.status === 429);
  } catch (e) {
    return networkResult(e);
  }
}

export async function checkUrl(url, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const vid = youtubeId(url);
  if (vid) return checkYouTube(vid, o);

  let current = url;
  for (let hop = 0; hop <= 6; hop++) {
    let res;
    try {
      res = await o.fetch(current, { redirect: "manual", headers: HEADERS, signal: AbortSignal.timeout(o.timeoutMs) });
    } catch (e) {
      return networkResult(e);
    }
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      await res.body?.cancel().catch(() => {});
      try { current = new URL(loc, current).href; } catch { return warn("転送先の URL が正しくありません"); }
      continue;
    }

    const s = res.status;
    const move = describeMove(url, current);
    if (move && move.type === "other-site") { await res.body?.cancel().catch(() => {}); return dead(`別のサイト（${move.host}）に転送されます`); }
    if (s === 404 || s === 410) {
      await res.body?.cancel().catch(() => {});
      return dead(s === 404 ? "ページが見つかりません（404）" : "削除されたページです（410）");
    }
    if (s >= 400) {
      await res.body?.cancel().catch(() => {});
      if (s === 401 || s === 403) return warn(`アクセスを断られました（${s}）。自動チェックを断るサイトかもしれません`);
      if (s === 429) return warn("アクセスが多すぎると断られました（429）", true);
      if (s >= 500) return warn(`相手のサーバーのエラーです（${s}）。一時的なものかもしれません`, true);
      return warn(`開けませんでした（${s}）`);
    }
    if (move && move.type === "top") { await res.body?.cancel().catch(() => {}); return dead("サイトのトップページに転送されます"); }
    if (move && move.type === "upper") { await res.body?.cancel().catch(() => {}); return dead("記事ではなく、一覧などの上のページに転送されます"); }

    const title = pageTitle(await readSome(res, 262144));
    if (NOT_FOUND.some((re) => re.test(title))) return dead(`ページに「${title.slice(0, 50)}」と表示されています`);
    return { level: "ok", reason: "", title, movedTo: current !== url ? current : "" };
  }
  return warn("転送が多すぎて、最後まで確かめられませんでした");
}

/* ---------- まとめて確かめる ---------- */

export async function checkAll(items, opts = {}, onDone = () => {}) {
  const o = { ...DEFAULTS, ...opts };
  const results = new Array(items.length);
  const nextSlot = new Map();
  let next = 0;

  async function polite(url) { // 同じサイトへのアクセスに間隔をあける
    let host = "";
    try { host = new URL(url).hostname; } catch { /* 何もしない */ }
    const now = Date.now(), at = Math.max(now, nextSlot.get(host) || 0);
    nextSlot.set(host, at + o.hostGapMs);
    if (at > now) await sleep(at - now);
  }
  async function worker() {
    while (next < items.length) {
      const i = next++;
      await polite(items[i].url);
      let r = await checkUrl(items[i].url, o);
      if (r.level === "warn" && r.retry) {
        await sleep(o.retryDelayMs);
        await polite(items[i].url);
        r = await checkUrl(items[i].url, o);
      }
      results[i] = r;
      onDone(items[i], r);
    }
  }
  await Promise.all(Array.from({ length: Math.min(o.concurrency, items.length) }, worker));
  return results;
}

/* ---------- 結果のお知らせ文 ---------- */

const cell = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/</g, "&lt;").replace(/\r?\n/g, " ");
const linkText = (s) => cell(s).replace(/\[/g, "\\[").replace(/\]/g, "\\]");
const short = (s, n) => (s.length > n ? s.slice(0, n) + "…" : s);

function table(rows) {
  const out = ["| 行 | 掲載日 | 媒体 | タイトル | 判定の理由 |", "|---:|---|---|---|---|"];
  for (const { it, r } of rows) {
    out.push(`| ${it.line} | ${it.date || "日付不明"} | ${cell(it.media)} | [${linkText(short(it.title, 60))}](${it.url}) | ${cell(r.reason)} |`);
  }
  return out.join("\n");
}

export function buildReport(rows, checkedOn) {
  const deadRows = rows.filter(({ it, r }) => it.state === "公開" && r.level === "dead");
  const revived = rows.filter(({ it, r }) => it.state === "リンク切れ" && r.level === "ok");
  const warnRows = rows.filter(({ it, r }) => it.state === "公開" && r.level === "warn");
  const nPublic = rows.filter(({ it }) => it.state === "公開").length;
  const nDead = rows.length - nPublic;
  const md = [`# リンクの確認結果（${checkedOn}）`, "", `公開中の記事 ${nPublic} 件と、「リンク切れ」にしている記事 ${nDead} 件を確かめました。`, ""];

  if (deadRows.length) {
    md.push(`## ✗ リンク切れの可能性が高い記事（${deadRows.length} 件）`, "", table(deadRows), "",
      "**対応のしかた**", "",
      "1. タイトルのリンクを開いて、本当に記事が見られないか確かめます。",
      "2. 見られなければ、`data/articles.csv` の「行」の番号の行で、状態を `公開` から `リンク切れ` に書き換えます。",
      "3. 記事が別の URL に移っていたら、URL を新しいものに書き換えます（状態は `公開` のまま）。",
      "4. 問題なく見られたら、そのままで大丈夫です。毎回まちがって引っかかる記事は、メモ列に `リンク確認不要` と書くとチェックから外れます。",
      "");
  }
  if (revived.length) {
    md.push(`## ↺ 開けるようになった記事（${revived.length} 件）`, "", "「リンク切れ」にしている記事のうち、今は開ける記事です。中身を確かめて、問題なければ状態を `公開` に戻してください。", "", table(revived), "");
  }
  if (!deadRows.length && !revived.length) md.push("対応が必要な記事はありませんでした。", "");
  if (warnRows.length) {
    md.push(`## △ 自動では確かめられなかった記事（${warnRows.length} 件）`, "",
      "自動チェックを断るサイトが多く、たいていは問題ありません。気になるものだけ開いて確かめてください。この欄だけのときは、お知らせ（Issue）は作られません。", "",
      table(warnRows), "");
  }
  md.push("---", "このお知らせは `tools/check-links.mjs` が自動で作りました。直し終わったら、次のチェックで問題がなくなると自動で閉じます（手で閉じてもかまいません）。");
  return { markdown: md.join("\n"), problems: deadRows.length + revived.length, warnings: warnRows.length };
}

/* ---------- 実行 ---------- */

async function main() {
  const args = process.argv.slice(2);
  const reportPath = args.includes("--report") ? args[args.indexOf("--report") + 1] : "";
  const parsed = parseArticles(await readFile("data/articles.csv", "utf8"));
  if (parsed.errors.length) console.log(`△ 書式に問題がある行が ${parsed.errors.length} 件あり、その行は確かめていません（node tools/validate.mjs で確認できます）\n`);
  const targets = parsed.items.filter((it) => it.state !== "非表示" && !it.note.includes("リンク確認不要"));
  console.log(`${targets.length} 件のリンクを確かめます…\n`);

  const mark = { ok: "✓", dead: "✗", warn: "△" };
  const results = await checkAll(targets, {}, (it, r) => {
    console.log(`${mark[r.level]} ${String(it.line).padStart(3)}行目  ${it.media}｜${short(it.title, 40)}${r.reason ? "  — " + r.reason : ""}`);
  });

  const today = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" }).format(new Date());
  const report = buildReport(targets.map((it, i) => ({ it, r: results[i] })), today);
  console.log(`\n対応が必要：${report.problems} 件／要確認：${report.warnings} 件`);

  if (reportPath) await writeFile(reportPath, report.markdown + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report.markdown + "\n");
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `problems=${report.problems}\nwarnings=${report.warnings}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
