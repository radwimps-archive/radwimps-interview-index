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

const $ = (s) => document.querySelector(s);

/* ---------- 印の読み書き ---------- */

const STORE_MARKS = "radwimps-interview-index:marks";       // assets/app.js と同じ：fv お気に入り・lt あとで読む・rd 既読・bm 以前の「お気に入り（★）」
const STORE_ATTENDED = "radwimps-interview-index:attended"; // assets/attended.js と同じ：公演日（2つ目からは「#2」付き）
const ATT_KEY = /^\d{4}(-\d{2}){0,2}(#\d{1,2})?$/;

const readJSON = (key) => { try { const v = JSON.parse(localStorage.getItem(key)); return v && typeof v === "object" ? v : {}; } catch { return {}; } };
const writeJSON = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; } };
const idsOf = (o) => new Set(o && typeof o === "object" ? Object.keys(o).filter((k) => o[k] && k.length < 160) : []);

function loadMarks() {
  const m = readJSON(STORE_MARKS);
  // 以前の「お気に入り（★）」は、記事一覧と同じく「あとで読む」として扱う
  return { fv: idsOf(m.fv), lt: new Set([...idsOf(m.lt), ...idsOf(m.bm)]), rd: idsOf(m.rd) };
}
const loadAttended = () => new Set([...idsOf(readJSON(STORE_ATTENDED))].filter((k) => ATT_KEY.test(k)));

// 印を付ける・外す（ほかの印はそのまま残す）
function setMark(kind, id, on) {
  const m = readJSON(STORE_MARKS);
  for (const k of ["fv", "lt", "rd", "bm"]) if (!m[k] || typeof m[k] !== "object") m[k] = {};
  if (on) m[kind][id] = 1; else delete m[kind][id];
  if (kind === "lt" && !on) delete m.bm[id]; // 以前の「お気に入り（★）」に残っていると、記事一覧で「あとで読む」に戻ってしまうため
  return writeJSON(STORE_MARKS, m);
}
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
const REMOVE_LABEL = { fv: "お気に入りから外す", lt: "あとで読むから外す", rd: "既読を外す", att: "参加した公演から外す" };

const p = new URLSearchParams(location.search);
let tab = TABS.some((t) => t.slug === p.get("tab")) ? p.get("tab") : "fv";
let group = GROUPS.includes(p.get("group")) ? p.get("group") : "person";
let articles = new Map(); // id → 記事（公開中のもの）
let lives = new Map();    // 印の名前 → 公演
let loaded = false;
let undo = null;          // 直前に外したもの（元に戻す用）

function saveUrl() {
  const q = new URLSearchParams();
  if (tab !== "fv") q.set("tab", tab);
  if (tab !== "att" && group !== "person") q.set("group", group);
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
    h("button", { type: "button", class: "shelf-remove", "data-remove": l.ak, "aria-label": `${dotDate(l.date)} ${l.venue || ""}を${REMOVE_LABEL.att}`, text: "外す" }));
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
  const many = list.length > 40; // 多いときは、最初のまとまりだけ開いておく
  body.replaceChildren(
    h("p", { class: "shelf-count", text: tab === "att" ? `${list.length}公演` : `${list.length}件` }),
    ...groups.map((g, i) => {
      const d = h("details", { class: "shelf-group-box", open: !many || i === 0 },
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
  undo = null;
  render();
  showStatus("元に戻しました。", false);
  $("#shelf").focus();
});

// 別のタブ（記事一覧やセットリスト）で印が変わったら、すぐ反映する
addEventListener("storage", (e) => { if (e.key === STORE_MARKS || e.key === STORE_ATTENDED || e.key === null) render(); });

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
    // 公演の印の名前は、公演日（同じ日の2つ目からは「#2」）。RAD LIVE SET LIST と同じく、ファイルの順（日付順）で付ける
    const seen = new Map();
    for (const l of parseSetlists(sText).lives) {
      const n = (seen.get(l.date) || 0) + 1;
      seen.set(l.date, n);
      l.ak = n === 1 ? l.date : `${l.date}#${n}`;
      lives.set(l.ak, l);
    }
    loaded = true;
    render();
  } catch (e) {
    console.error(e);
    $("#shelfBody").replaceChildren(h("p", { class: "shelf-empty", text: "棚の中身を読み込めませんでした。時間をおいて、ページを開き直してください。" }));
  }
})();
