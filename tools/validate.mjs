#!/usr/bin/env node
// tools/validate.mjs
// 記事データ（data/articles.csv）・年ごとのリリース（data/releases.csv）・年表（data/history.csv）の書式をチェックします。
//
// ・GitHub に変更を保存（コミット）すると、自動で実行されます。
//   エラーがあるとサイトの更新を止めるので、書き間違いがそのまま公開されることはありません。
//   （サイトはひとつ前の状態のまま表示され続けます）
// ・自分のパソコンで確かめる場合（Node.js が必要）：
//     node tools/validate.mjs

import { readFile } from "node:fs/promises";
import { parseArticles, parseReleases, parseHistory } from "../assets/data.js";

const inActions = process.env.GITHUB_ACTIONS === "true";
let errorCount = 0, warnCount = 0;

// GitHub の画面で、該当する行に印を付けるための書き方
const esc = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

function show(file, level, { line, msg }) {
  if (level === "error") errorCount++; else warnCount++;
  console.log(`${level === "error" ? "✗ エラー" : "△ 注意  "}  ${file} ${line}行目：${msg}`);
  if (inActions) console.log(`::${level === "error" ? "error" : "warning"} file=${file},line=${line}::${esc(msg)}`);
}

async function readText(file) {
  let buf;
  try { buf = await readFile(file); } catch { return { missing: true }; }
  try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(buf) }; }
  catch { return { badEncoding: true }; }
}

async function check(file, parse, { required }) {
  const r = await readText(file);
  if (r.missing) {
    if (required) show(file, "error", { line: 1, msg: "ファイルが見つかりません（名前や置き場所を変えていないか確かめてください）" });
    else show(file, "warning", { line: 1, msg: "ファイルが見つかりません（なくてもサイトは動きます）" });
    return null;
  }
  if (r.badEncoding) {
    show(file, "error", { line: 1, msg: "文字コードが UTF-8 ではありません。Excel では「CSV UTF-8（コンマ区切り）」を選んで保存し直してください" });
    return null;
  }
  const res = parse(r.text);
  for (const e of res.errors) show(file, "error", e);
  for (const w of res.warnings) show(file, "warning", w);
  return res;
}

console.log("記事データの書式をチェックします\n");
const articles = await check("data/articles.csv", parseArticles, { required: true });
await check("data/releases.csv", parseReleases, { required: false });
const history = await check("data/history.csv", parseHistory, { required: false });

if (articles) {
  const count = { "公開": 0, "非表示": 0, "リンク切れ": 0 };
  let videos = 0;
  for (const it of articles.items) {
    count[it.state]++;
    if (it.state === "公開" && it.format === "video") videos++;
  }
  console.log(`\n記事：${articles.items.length} 件を読み込みました（公開 ${count["公開"]}・非表示 ${count["非表示"]}・リンク切れ ${count["リンク切れ"]}）`);
  console.log(`サイトに出るのは、記事 ${count["公開"] - videos} 件・動画 ${videos} 件です`);
}
if (history) {
  const videos = history.events.reduce((n, e) => n + e.videos.length, 0);
  console.log(`年表：${history.events.length} 件の出来事を読み込みました（動画 ${videos} 本）`);
}
console.log(errorCount
  ? `\n✗ エラーが ${errorCount} 件あります。上の行番号の行を直してから、もう一度保存してください。`
  : `\n✓ 書式の問題はありません${warnCount ? `（注意 ${warnCount} 件）` : ""}。`);
process.exit(errorCount ? 1 : 0);
