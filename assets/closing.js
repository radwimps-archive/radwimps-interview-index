// assets/closing.js
// ベータ版の公開を終えたあとの「準備中」の案内ページの動き。
//   1. 保存データ（お気に入り・あとで読む・既読・参加した公演）の件数を出し、ファイルに書き出せるようにする
//      （書き出すファイルは、記事一覧の「保存データの管理」と同じ形。正式版の「保存データの管理」で読み込めます）
//   2. config.js の newsletter.action があれば、公開のお知らせメールの登録欄を出す
//   3. config.js の x があれば、X へのリンクを出す
// 保存データは読むだけで、消したり書き換えたりはしません。

import config from "./config.js";

const $ = (s) => document.querySelector(s);

// ---------- 保存データ ----------
const read = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const keysOf = (o) => (o && typeof o === "object" ? Object.keys(o).filter((k) => o[k] && k.length < 160) : []);
const marks = read("radwimps-interview-index:marks") || {};
const data = {
  app: "radwimps-interview-index", version: 5, exportedAt: "",
  bookmarks: [], favorites: keysOf(marks.fv),
  later: [...new Set([...keysOf(marks.lt), ...keysOf(marks.bm)])], // 以前の「お気に入り（★）」は、あとで読むとして書き出す（記事一覧の読み込みと同じ扱い）
  read: keysOf(marks.rd),
  attended: keysOf(read("radwimps-interview-index:attended")).filter((k) => /^\d{4}(-\d{2}){0,2}(#\d{1,2})?$/.test(k)).sort()
};
const counts = `お気に入り ${data.favorites.length} 件・あとで読む ${data.later.length} 件・既読 ${data.read.length} 件・参加した公演 ${data.attended.length} 件`;
const total = data.favorites.length + data.later.length + data.read.length + data.attended.length;

$("#dataCount").textContent = total ? `このブラウザには、${counts}が残っています。` : "このブラウザには、保存データはありません。";
// 保存データがあるときだけ、書き出しの説明とボタンを出す
$("#dataAbout").hidden = !total;
$("#dataActions").hidden = !total;
const exportBtn = $("#exportBtn");
exportBtn.addEventListener("click", () => {
  const d = new Date();
  data.exportedAt = d.toISOString();
  const name = `radwimps-archive-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  $("#dataMsg").textContent = `${counts}をファイルに書き出しました。`;
});

// ---------- X ----------
const X = /^[A-Za-z0-9_]{1,15}$/.test(config.x || "") ? config.x : "";
if (X) {
  const link = $("#xLink");
  link.href = `https://x.com/${X}`;
  link.querySelector("span").textContent = `X（@${X}）を見る`;
  $("#xBox").hidden = false;
}

// ---------- 公開のお知らせメール ----------
// newsletter.action：メール配信サービスの登録フォームの送り先（https:// で始まる URL）。
// 送り先のホスト名は、closing.html の CSP の form-action にも足すこと（足さないと、ブラウザが送信を止めます。送信後に別のホストへ移るサービスなら、そのホストも）。
// closing.html を直したら、tools/closing-switch.sh をもう一度実行して各ページに写し直す。
const NL = config.newsletter || {};
if (/^https:\/\/[^\s"']+$/.test(NL.action || "")) {
  const form = $("#mailForm");
  form.action = NL.action;
  if (NL.field) $("#mailInput").name = NL.field; // サービスによって、メールアドレスの欄の名前が違う（例：email・EMAIL）
  $("#mailBox").hidden = false;
  // 送ると、配信サービスの確認画面が新しいタブで開く（このページには何も出ないので、知らせる）
  form.addEventListener("submit", () => { $("#mailMsg").textContent = "新しいタブで、配信サービスの確認画面を開きました。"; });
}
