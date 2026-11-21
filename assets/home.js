// assets/home.js
// 玄関（index.html）の動き。
//   ・まだ読んでいない一節：このブラウザの既読の記録から、まだ読んでいない記事を1本選び、運営が書いた紹介文（記事データの「説明」）を出す。
//     選び方は「日替わり」：日本時間の日付から決まる番号で、まだ読んでいない記事の中から1本を選ぶ。
//     だから、同じ日に開き直しても同じ1本が出る（読んだら、次に開いたときは別の1本）。初めての人には、日替わりの1本と同じになる。
//     記事の本文や発言の引用は出さない（docs/concept.md の決まり）。
//   ・掲載元へのリンクを押したら、記事一覧と同じく既読にする（保存の形も記事一覧と同じ）。
//   ・メニューとベータ版の案内は、ほかのページと共通。

import "./analytics.js";
import { parseArticles, VIDEO_KIND, RADIO_KIND, RELEASE_KIND } from "./data.js";
import { h, setupMenu, isAdminDevice } from "./ui.js";
import { setupBeta } from "./feedback.js";

const $ = (s) => document.querySelector(s);

/* ---------- 既読の記録（記事一覧と同じ保存場所・同じ形） ---------- */

const STORE_MARKS = "radwimps-interview-index:marks"; // assets/app.js の STORE_MARKS と同じ
function loadMarks() {
  try {
    const m = JSON.parse(localStorage.getItem(STORE_MARKS));
    return m && typeof m === "object" ? m : {};
  } catch { return {}; }
}
const isRead = (marks, id) => !!(marks.rd && typeof marks.rd === "object" && marks.rd[id]);
// 既読にする。ほかの印（お気に入り・あとで読む）はそのまま残す。保存できない環境では何もしない
function markRead(id) {
  const m = loadMarks();
  if (!m.rd || typeof m.rd !== "object") m.rd = {};
  if (m.rd[id]) return;
  m.rd[id] = 1;
  try { localStorage.setItem(STORE_MARKS, JSON.stringify(m)); } catch { /* 保存できない環境 */ }
}

/* ---------- 日替わりの選び方 ---------- */

// 日本時間の今日の日付（例：2026-11-21）
export function todayKey(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
// 文字から番号を作る（同じ文字なら、いつでも同じ番号。FNV-1a という簡単な計算）
export function hashOf(text) {
  let x = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { x ^= text.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
  return x;
}
// 一節として出せる記事：公開中で、紹介文（説明）があり、リリース情報・参考資料ではないもの。順番は id でそろえる（並びが変わらないように）
export function candidatesOf(items) {
  return items
    .filter((it) => it.state === "公開" && it.id && it.summary && it.kind !== RELEASE_KIND && !/^参考資料/.test(it.note || ""))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
// まだ読んでいない記事から、今日の1本を選ぶ（全部読んでいたら null）
export function pickUnread(candidates, readIds, day) {
  const unread = candidates.filter((it) => !readIds.has(it.id));
  return unread.length ? unread[hashOf(day) % unread.length] : null;
}

/* ---------- 表示 ---------- */

const dotDate = (d) => d.split("-").join(".");
let unread = [];
let current = null;

function show(it) {
  current = it;
  const card = $("#encounterCard");
  if (!it) {
    card.replaceChildren(
      h("p", { class: "encounter-empty", text: "掲載している記事は、このブラウザではすべて既読になっています。" }),
      h("div", { class: "encounter-actions" }, h("a", { class: "home-btn", href: "articles.html", text: "記事一覧を見る" })));
    return;
  }
  const verb = it.kind === VIDEO_KIND ? "見る" : it.kind === RADIO_KIND ? "聴く" : "読む";
  const meta = [it.media, it.date ? dotDate(it.date) : "", it.kind].filter(Boolean).join(" · ");
  const open = h("a", { class: "home-btn primary", href: it.url, target: "_blank", rel: "noopener noreferrer", "data-open": "" },
    h("span", { text: `${it.media}で${verb}` }), h("span", { class: "arrow", "aria-hidden": "true", text: "↗" }), h("span", { class: "sr", text: "（新しいタブで開きます）" }));
  const actions = h("div", { class: "encounter-actions" }, open);
  if (unread.length > 1) actions.append(h("button", { type: "button", class: "home-btn", id: "encounterNext", text: "ほかの一節" }));
  card.replaceChildren(
    h("p", { class: "encounter-meta", text: meta }),
    h("p", { class: "encounter-text", text: it.summary }),
    h("p", { class: "encounter-title", text: it.title }),
    actions);
}

// 「ほかの一節」：まだ読んでいない記事から、いま出ているもの以外を1本
function showAnother() {
  const others = unread.filter((it) => it !== current);
  if (!others.length) return;
  show(others[Math.floor(Math.random() * others.length)]);
  const next = $("#encounterNext");
  if (next) next.focus();
}

$("#encounterCard").addEventListener("click", (e) => {
  if (e.target.closest("#encounterNext")) { showAnother(); return; }
  if (e.target.closest("[data-open]") && current) markRead(current.id);
});
// 中ボタンで開いたときも既読にする
$("#encounterCard").addEventListener("auxclick", (e) => {
  if (e.button === 1 && e.target.closest("[data-open]") && current) markRead(current.id);
});

/* ---------- はじめに ---------- */

setupMenu();
setupBeta($("#main").firstElementChild);
if (isAdminDevice()) $("#adminLink").hidden = false;

(async () => {
  try {
    const res = await fetch("data/articles.csv", { cache: "no-cache" });
    if (!res.ok) throw new Error("articles.csv: HTTP " + res.status);
    const all = candidatesOf(parseArticles(await res.text()).items);
    const marks = loadMarks();
    const readIds = new Set(all.filter((it) => isRead(marks, it.id)).map((it) => it.id));
    unread = all.filter((it) => !readIds.has(it.id));
    show(pickUnread(all, readIds, todayKey()));
  } catch (e) {
    console.error(e);
    $("#encounterCard").replaceChildren(h("p", { class: "encounter-empty", text: "記事データを読み込めませんでした。時間をおいて、ページを開き直してください。" }));
  }
})();
