// assets/shelf.js
// 「あなたの棚」（shelf.html）の動き。
//   ・棚の段：お気に入り・あとで読む・既読（記事一覧の印）と、参加した公演（RAD LIVE SET LIST・RADWIMPSの歩みの足あとの印）。
//   ・記事の段は、人・曲や作品・年代・ライブごとに分けて並べる（分け方の計算は shelf-data.js）。参加した公演は、ライブ名ごと。
//   ・「外す」で棚から出せる。すぐ下の「元に戻す」で取り消せる。
//   ・印の保存場所と形は、記事一覧（assets/app.js）・参加した公演（assets/attended.js）と同じ。別のタブで印が変わったら、すぐ反映する。
//   ・選んでいる段と分け方は URL（?tab=…&group=…）に残す（あとで開き直しても同じ見え方になるように）。

import "./analytics.js";
import { parseArticles, parseSetlists, VIDEO_KIND, RADIO_KIND } from "./data.js";
import { groupArticles, groupLives } from "./shelf-data.js";
import { h, setupMenu, isAdminDevice, watchScrollFade } from "./ui.js";
import { setupBeta } from "./feedback.js";
import { assignKeys } from "./attended.js";
import { STORE_MARKS, loadMarks, setMark, readJSON, writeJSON, idsOf } from "./marks.js";

const $ = (s) => document.querySelector(s);

/* ---------- 印の読み書き ---------- */

// 記事の印（お気に入り・あとで読む・既読）の読み書きは assets/marks.js（楽曲一覧・メンバー紹介と同じもの）
const STORE_ATTENDED = "radwimps-interview-index:attended"; // assets/attended.js と同じ：公演日（2つ目からは「#2」付き）
const ATT_KEY = /^\d{4}(-\d{2}){0,2}(#\d{1,2})?$/;

const loadAttended = () => new Set([...idsOf(readJSON(STORE_ATTENDED))].filter((k) => ATT_KEY.test(k)));

function setAttended(key, on) {
  const a = readJSON(STORE_ATTENDED);
  if (on) a[key] = 1; else delete a[key];
  return writeJSON(STORE_ATTENDED, a);
}

/* ---------- 状態 ---------- */

const TABS = [
  { slug: "fv", name: "お気に入り", empty: "お気に入りはまだありません。記事一覧で、記事の♡を押すと、ここに入ります。" },
  { slug: "lt", name: "あとで読む", empty: "あとで読む記事はまだありません。記事一覧で、記事の「あとで読む」を押すと、ここに入ります。" },
  { slug: "rd", name: "既読", empty: "既読の記事はまだありません。記事一覧などで記事を開くと、既読としてここに入ります。" },
  { slug: "att", name: "参加した公演", empty: "参加した公演はまだありません。RAD LIVE SET LIST や RADWIMPSの歩みで、公演の足あとのボタンを押すと、ここに入ります。" }
];
const GROUPS = ["person", "work", "year", "live"];
const REMOVE_LABEL = { fv: "お気に入りから外す", lt: "あとで読むから外す", rd: "既読から外す", att: "参加した公演から外す" };

const p = new URLSearchParams(location.search);
let tab = TABS.some((t) => t.slug === p.get("tab")) ? p.get("tab") : "fv";
let group = GROUPS.includes(p.get("group")) ? p.get("group") : "person";
let articles = new Map(); // id → 記事（公開中のもの）
let lives = new Map();    // 印の名前 → 公演
let loaded = false;
let undo = null;          // 直前に外したもの（元に戻す用）
const toggled = new Map(); // 利用者が開け閉めしたまとまり（「段:分け方:見出し」→ 開いているか）。並べ直しても、その状態を保つ

function saveUrl() {
  const q = new URLSearchParams();
  if (tab !== "fv") q.set("tab", tab);
  if (group !== "person") q.set("group", group); // 公演の段でも、記事の段で選んだ分け方は残す
  try { history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "")); } catch { /* 変えられない環境 */ }
}

// いまの段に入っているもの（記事データ・公演データにあるものだけ）
function itemsOf(slug, marks = loadMarks(), att = loadAttended()) {
  if (slug === "att") return [...att].map((k) => lives.get(k)).filter(Boolean);
  return [...marks[slug]].map((id) => articles.get(id)).filter(Boolean);
}

/* ---------- 表示 ---------- */

const dotDate = (d) => (d || "").split("-").join(".");

function renderTabs() {
  const marks = loadMarks(), att = loadAttended();
  $("#shelfTabs").replaceChildren(...TABS.map((t) => {
    const n = loaded ? itemsOf(t.slug, marks, att).length : 0;
    return h("button", { type: "button", "data-tab": t.slug, "aria-pressed": String(t.slug === tab), "aria-label": `${t.name} ${n}件` },
      h("span", { text: t.name }), h("small", { text: String(n) }));
  }));
  $("#shelfTools").hidden = tab === "att";
  for (const b of document.querySelectorAll("#shelfGroup [data-group]")) b.setAttribute("aria-pressed", String(b.dataset.group === group));
}

function articleRow(it) {
  const verb = it.kind === VIDEO_KIND ? "見る" : it.kind === RADIO_KIND ? "聴く" : "読む";
  const meta = [it.media, it.date ? dotDate(it.date) : "", it.kind].filter(Boolean).join(" · ");
  return h("li", { class: "shelf-item" },
    h("div", { class: "shelf-item-main" },
      h("a", { class: "shelf-item-title", href: it.url, target: "_blank", rel: "noopener noreferrer", "data-open": it.id },
        it.title, h("span", { class: "sr", text: `（${it.media}で${verb}。新しいタブで開きます）` })),
      h("p", { class: "shelf-item-meta", text: meta })),
    h("button", { type: "button", class: "shelf-remove", "data-remove": it.id, "aria-label": `「${it.title}」を${REMOVE_LABEL[tab]}`, text: "外す" }));
}

function liveRow(l) {
  return h("li", { class: "shelf-item" },
    h("div", { class: "shelf-item-main" },
      h("p", { class: "shelf-item-title shelf-live-date", text: dotDate(l.date) }),
      h("p", { class: "shelf-item-meta", text: l.venue || "会場不明" })),
    h("a", { class: "shelf-setlist", href: "setlist.html#mine", text: "セトリ" , "aria-label": `${dotDate(l.date)} ${l.venue || ""}のセットリストを、RAD LIVE SET LIST の「参加公演」で見る` }),
    h("button", { type: "button", class: "shelf-remove", "data-remove": l.ak, "aria-label": `${dotDate(l.date)} ${l.venue || ""}を${REMOVE_LABEL.att}`, text: "外す" }));
}

// 並べ直したあとも、フォーカスのあった「外す」ボタン（同じ記事・公演）に戻す
function keepFocus(fn) {
  const a = document.activeElement;
  const key = a && a.closest && a.closest("#shelfBody") && (a.dataset.remove || a.dataset.open);
  const attr = a && a.dataset && a.dataset.remove ? "data-remove" : "data-open";
  fn();
  if (key) { const again = document.querySelector(`#shelfBody [${attr}="${CSS.escape(key)}"]`); if (again) again.focus(); }
}

function render() {
  renderTabs();
  if (!loaded) return;
  const body = $("#shelfBody");
  const list = itemsOf(tab);
  const t = TABS.find((x) => x.slug === tab);
  if (!list.length) {
    // 棚が空のとき（羊のメモは、絵と名前が決まってからここに置く）
    body.replaceChildren(h("p", { class: "shelf-empty", text: t.empty }));
    return;
  }
  const groups = tab === "att" ? groupLives(list) : groupArticles(list, group);
  const many = list.length > 40; // 多いときは、最初のまとまりだけ開いておく（利用者が開け閉めしたものは、その状態を保つ）
  const view = tab === "att" ? "att" : `${tab}:${group}`;
  body.replaceChildren(
    h("p", { class: "shelf-count", text: tab === "att" ? `${list.length}公演` : `${list.length}件` }),
    ...groups.map((g, i) => {
      const id = `${view}:${g.name}`;
      const d = h("details", { class: "shelf-group-box", open: toggled.has(id) ? toggled.get(id) : (!many || i === 0), "data-gid": id },
        h("summary", null, h("span", { class: "shelf-group-name", text: g.name }), h("span", { class: "shelf-group-count", text: tab === "att" ? `${g.items.length}公演` : `${g.items.length}件` })),
        h("ul", { class: "shelf-items" }, ...g.items.map(tab === "att" ? liveRow : articleRow)));
      return d;
    }));
}

function showStatus(text, withUndo) {
  const box = $("#shelfStatus");
  box.replaceChildren(h("span", { text }), withUndo ? h("button", { type: "button", class: "shelf-undo", id: "shelfUndo", text: "元に戻す" }) : "");
}

/* ---------- 操作 ---------- */

$("#shelfTabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (!b || b.dataset.tab === tab) return;
  tab = b.dataset.tab; undo = null; $("#shelfStatus").replaceChildren();
  saveUrl(); render();
});
$("#shelfGroup").addEventListener("click", (e) => {
  const b = e.target.closest("[data-group]");
  if (!b || b.dataset.group === group) return;
  group = b.dataset.group; saveUrl(); render();
});

$("#shelfBody").addEventListener("click", (e) => {
  const rm = e.target.closest("[data-remove]");
  if (rm) {
    const key = rm.dataset.remove;
    const ok = tab === "att" ? setAttended(key, false) : setMark(tab, key, false);
    if (!ok) { showStatus("このブラウザでは保存できないため、外せませんでした。", false); return; }
    undo = { tab, key };
    const name = tab === "att" ? `${dotDate(lives.get(key)?.date)} の公演` : `「${articles.get(key)?.title || ""}」`;
    render();
    showStatus(`${name}を${REMOVE_LABEL[tab].replace(/外す$/, "外しました")}。`, true);
    $("#shelfUndo").focus();
    return;
  }
  // 記事を開いたら、既読にする（記事一覧と同じ）。既読の段にいるときは表示は変わらない
  const open = e.target.closest("[data-open]");
  if (open) { const m = loadMarks(); if (!m.rd.has(open.dataset.open)) { setMark("rd", open.dataset.open, true); renderTabs(); } }
});
// 中ボタンで開いたときも既読にする
$("#shelfBody").addEventListener("auxclick", (e) => {
  const open = e.button === 1 && e.target.closest("[data-open]");
  if (open && !loadMarks().rd.has(open.dataset.open)) { setMark("rd", open.dataset.open, true); renderTabs(); }
});
$("#shelfStatus").addEventListener("click", (e) => {
  if (!e.target.closest("#shelfUndo") || !undo) return;
  if (undo.tab === "att") setAttended(undo.key, true); else setMark(undo.tab, undo.key, true);
  const back = undo.key;
  undo = null;
  render();
  showStatus("元に戻しました。", false);
  // 戻した記事・公演の「外す」ボタンへ（見つからなければ一覧の先頭へ）
  const btn = document.querySelector(`#shelfBody [data-remove="${CSS.escape(back)}"]`);
  if (btn) { const box = btn.closest("details"); if (box) box.open = true; btn.focus(); } else $("#shelf").focus();
});

// 別のタブ（記事一覧やセットリスト）で印が変わったら、すぐ反映する
addEventListener("storage", (e) => { if (e.key === STORE_MARKS || e.key === STORE_ATTENDED || e.key === null) keepFocus(render); });
// まとまりを開け閉めしたら覚えておく（並べ直しても、その状態のまま）
$("#shelfBody").addEventListener("toggle", (e) => { const d = e.target; if (d.dataset && d.dataset.gid) toggled.set(d.dataset.gid, d.open); }, true);

/* ---------- はじめに ---------- */

setupMenu();
watchScrollFade($("#shelfTabs")); // スマホで段のタブが横にはみ出すとき、続きがある側の端をぼかす
setupBeta($("#main").firstElementChild);
if (isAdminDevice()) $("#adminLink").hidden = false;
render();

(async () => {
  try {
    const get = (f) => fetch(f, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r.text(); });
    const [aText, sText] = await Promise.all([get("data/articles.csv"), get("data/setlists.csv")]);
    articles = new Map(parseArticles(aText).items.filter((it) => it.state === "公開" && it.id).map((it) => [it.id, it]));
    // 公演の印の名前は、公演日（同じ日の2つ目からは「#2」）。RAD LIVE SET LIST と同じ assignKeys で付ける
    const list = parseSetlists(sText).lives;
    assignKeys(list);
    for (const l of list) lives.set(l.ak, l);
    loaded = true;
    render();
  } catch (e) {
    console.error(e);
    $("#shelfBody").replaceChildren(h("p", { class: "shelf-empty", text: "棚の中身を読み込めませんでした。時間をおいて、ページを開き直してください。" }));
  }
})();
