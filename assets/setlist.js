// assets/setlist.js
// 「ライブのセトリ」のページの動き。データは data/setlists.csv です（ここを書き換えると、このページが変わります）。
// CSV の「ライブ名」が同じ公演は、1つのツアー（またはイベント）としてまとめて表示します。
// 上の切り替えで、2つの見え方を選べます（URL の末尾 #live・#nenpyo でも開けます）。
//   ライブ：ツアーごと。ツアーを押すと全公演が並び、公演を押すとその日のセットリスト（曲順）が開く。新しいツアーが上
//   年表　：年ごとに、ツアーと、そのツアーで演奏した曲を並べたもの。古いツアーが上。
//           曲名を押すと、その曲を演奏したツアーと日付だけになる（?song=曲名 でも開けます）

import { parseSetlists, songKey, SETLIST_CONFIDENCE } from "./data.js";
import { h as el, setupMenu, isAdminDevice } from "./ui.js";
import { feedbackUrl, hasFeedback, setupBeta, KIND } from "./feedback.js";
import "./analytics.js";

const $ = (s) => document.querySelector(s);
const VIEWS = ["live", "nenpyo"];

let lives = [];          // 公演（古い順）
let tours = [];          // ツアー（古い順）：{ id, name, lives: [公演], y }
let songs = new Map();   // 曲の名前（songKey）→ { title, plays: [{ live, memo }] }
let view = "live";
let song = "";           // 年表で選んでいる曲（songKey）

const pad = (n) => String(n).padStart(2, "0");
const dateLabel = (l) => (l.d ? `${l.y}.${pad(l.m)}.${pad(l.d)}` : l.m ? `${l.y}.${pad(l.m)}` : String(l.y));
const shortDate = (l) => (l.d ? `${pad(l.m)}.${pad(l.d)}` : l.m ? `${pad(l.m)}月` : "");
const songsOf = (l) => [...l.main, ...l.encore];
const hasSongs = (l) => l.main.length + l.encore.length > 0;
const liveId = (l) => `live-${l.date}-${l.i}`;

// ツアーの期間（例：2025.10.18 – 12.27）
function periodLabel(t) {
  const a = t.lives[0], b = t.lives[t.lives.length - 1];
  if (a === b || a.date === b.date) return dateLabel(a);
  return `${dateLabel(a)} – ${b.y !== a.y ? dateLabel(b) : shortDate(b)}`;
}

// ライブ名ごとにまとめる（並びは、いちばん早い公演の日付順）
function groupTours() {
  const map = new Map();
  for (const l of lives) {
    const t = map.get(l.name) || map.set(l.name, { id: `tour-${map.size}`, name: l.name, lives: [] }).get(l.name);
    t.lives.push(l);
    l.tour = t;
  }
  tours = [...map.values()];
  for (const t of tours) t.y = t.lives[0].y;
}

// 曲ごとの記録を作る（同じ公演で2回やった曲は、1公演として数える）
function indexSongs() {
  songs = new Map();
  for (const l of lives) {
    for (const s of songsOf(l)) {
      const k = songKey(s.title);
      const rec = songs.get(k) || songs.set(k, { title: s.title, plays: [] }).get(k);
      if (!rec.plays.some((p) => p.live === l)) rec.plays.push({ live: l, memo: s.memo });
    }
  }
}

const badge = (c) => el("span", { class: `sl-conf conf-${c.slug}`, title: c.desc, text: c.label });

/* ---------- ライブ：ツアーごとの全公演と、公演ごとのセットリスト ---------- */

function songItem(s, n) {
  return el("li", { value: String(n) },
    el("button", { type: "button", class: "sl-song", "data-song": songKey(s.title), title: `「${s.title}」を演奏したライブを年表で見る` }, s.title),
    s.memo ? el("small", { class: "sl-memo", text: s.memo }) : null);
}

// 1公演のセットリストと、出典など
function setlistBody(l) {
  const body = el("div", { class: "sl-live-body" });
  if (!hasSongs(l)) body.append(el("p", { class: "sl-none", text: "この公演のセットリストは、まだ確かめられていません。" }));
  else {
    body.append(el("ol", { class: "sl-songs" }, ...l.main.map((s, i) => songItem(s, i + 1))));
    if (l.encore.length) {
      body.append(el("h4", { class: "sl-encore", text: "アンコール" }),
        el("ol", { class: "sl-songs" }, ...l.encore.map((s, i) => songItem(s, l.main.length + i + 1))));
    }
  }
  const info = el("dl", { class: "sl-info" });
  const row = (k, v) => v && info.append(el("dt", { text: k }), el("dd", {}, v));
  row("ゲスト", l.guests.join("・"));
  row("メモ", l.note);
  row("確かさ", l.conf.desc);
  row("出典", l.url ? el("a", { href: l.url, target: "_blank", rel: "noopener noreferrer", text: `${l.source || "出典"} ↗` }) : l.source);
  if (info.childNodes.length) body.append(info);
  return body;
}

// ツアーの中の1公演（押すとセットリストが開く）
function showRow(l, open) {
  return el("details", { class: "sl-show", id: liveId(l), open: open || null },
    el("summary", {},
      el("time", { datetime: l.date, text: dateLabel(l) }),
      el("span", { class: "sl-show-venue", text: l.venue || "" }),
      el("span", { class: "sl-show-meta" }, hasSongs(l) ? `${songsOf(l).length}曲` : "", badge(l.conf))),
    setlistBody(l));
}

function tourCard(t, open) {
  const n = t.lives.length, withSongs = t.lives.filter(hasSongs).length;
  const one = n === 1 ? t.lives[0] : null;
  const card = el("details", { class: "sl-live", id: t.id, open: open || null },
    el("summary", {},
      el("p", { class: "hist-meta" }, el("time", { text: periodLabel(t) }), one ? badge(one.conf) : null),
      el("h2", { class: "sl-live-name", text: t.name }),
      el("p", { class: "sl-live-venue" },
        one ? (one.venue || "") : `${n}公演`,
        el("span", { class: "sl-count", text: one ? (hasSongs(one) ? `${songsOf(one).length}曲` : "セトリ未確認") : `セトリあり ${withSongs}／${n}` }))));
  if (one) { const b = setlistBody(one); b.id = liveId(one); card.append(b); }
  else card.append(el("div", { class: "sl-shows" }, ...t.lives.map((l) => showRow(l, false))));
  return card;
}

function renderLives() {
  const box = $("#lives");
  box.replaceChildren(el("p", { class: "hist-view sl-view" }, el("b", { text: "ツアー・ライブごと" }),
    el("span", { text: `${tours.length} 件・${lives.length} 公演・新しい順` })));
  [...tours].reverse().forEach((t, i) => box.append(tourCard(t, i === 0)));
}

/* ---------- 年表：年ごとのツアーと、演奏した曲 ---------- */

function renderSongInfo() {
  const box = $("#songInfo");
  box.replaceChildren();
  $("#songClear").hidden = !song;
  if (song && songs.has(song)) {
    const rec = songs.get(song), first = rec.plays[0].live, last = rec.plays[rec.plays.length - 1].live;
    const nTours = new Set(rec.plays.map((p) => p.live.tour)).size;
    box.append(
      el("p", { class: "sl-song-head" }, el("b", { text: `「${rec.title}」` }), `を演奏したライブ：${rec.plays.length} 公演（${nTours} ツアー・ライブ）`),
      el("p", { class: "sl-song-sub", text: `ここに載っている中で、いちばん早いのは ${dateLabel(first)}「${first.name}」` + (last !== first ? `、いちばん新しいのは ${dateLabel(last)}「${last.name}」` : "") + "。セトリを確かめられた公演だけを数えています。" }));
    return;
  }
  // 曲を選んでいないときは、よく演奏された曲を並べる
  const top = [...songs.entries()].sort((a, b) => b[1].plays.length - a[1].plays.length || a[1].plays[0].live.i - b[1].plays[0].live.i).slice(0, 12);
  box.append(el("p", { class: "sl-song-sub", text: `セトリを確かめられた ${lives.filter(hasSongs).length} 公演で、よく演奏された曲（数字は公演数。押すと、その曲を演奏したライブだけになります）` }),
    el("div", { class: "sl-chips" }, ...top.map(([k, r]) => el("button", { type: "button", class: "sl-chip", "data-song": k }, r.title, el("small", { text: ` ${r.plays.length}` })))));
}

// ツアーで演奏した曲（はじめて出てきた順）と、何公演で演奏したか
function tourSongs(t) {
  const m = new Map();
  for (const l of t.lives) for (const s of songsOf(l)) {
    const k = songKey(s.title);
    const r = m.get(k) || m.set(k, { k, title: s.title, lives: new Set() }).get(k);
    r.lives.add(l);
  }
  return [...m.values()];
}

function renderTimeline() {
  const box = $("#timeline");
  box.replaceChildren();
  const rec = song ? songs.get(song) : null;
  const list = rec ? tours.filter((t) => rec.plays.some((p) => p.live.tour === t)) : tours;
  const years = new Map();
  for (const t of list) (years.get(t.y) || years.set(t.y, []).get(t.y)).push(t);
  for (const [y, items] of years) {
    const ol = el("ol", { class: "hist-list" });
    for (const t of items) {
      const n = t.lives.length, withSongs = t.lives.filter(hasSongs).length;
      const item = el("li", { class: "hist-item cat-live" },
        el("p", { class: "hist-meta" }, el("time", { text: periodLabel(t) }), n === 1 ? badge(t.lives[0].conf) : null),
        el("p", { class: "hist-title" }, el("a", { href: `#${t.id}`, class: "sl-to-live", "data-tour": t.id, text: t.name })),
        el("p", { class: "hist-sub", text: n === 1 ? [t.lives[0].venue, hasSongs(t.lives[0]) ? `${songsOf(t.lives[0]).length}曲` : "セトリ未確認"].filter(Boolean).join(" ／ ") : `${n}公演（セトリあり ${withSongs}）` }));
      if (rec) {
        // 選んだ曲を、このツアーのどの公演で演奏したか
        const plays = rec.plays.filter((p) => p.live.tour === t);
        item.append(el("p", { class: "sl-played" },
          el("b", { text: n === 1 ? "演奏した" : `${plays.length}／${withSongs} 公演で演奏` }),
          n === 1 ? (plays[0].memo ? `（${plays[0].memo}）` : "") : "：",
          ...(n === 1 ? [] : plays.map((p, i) => [i ? "、" : "", el("a", { href: `#${liveId(p.live)}`, class: "sl-to-live", "data-live": liveId(p.live), "data-tour": t.id, text: `${dateLabel(p.live)} ${p.live.venue.replace(/（.*）$/, "")}` })]).flat())));
      }
      const chips = el("div", { class: "sl-chips" });
      for (const s of tourSongs(t)) {
        chips.append(el("button", { type: "button", class: "sl-chip" + (s.k === song ? " on" : ""), "data-song": s.k, "aria-pressed": String(s.k === song) },
          s.title, n > 1 && withSongs > 1 ? el("small", { text: ` ${s.lives.size}` }) : null));
      }
      if (chips.childNodes.length) item.append(chips);
      ol.append(item);
    }
    box.append(el("section", { class: "hist-year", id: `y${y}`, "aria-labelledby": `yh${y}` },
      el("h2", { id: `yh${y}`, class: "hist-year-head" }, el("span", { text: String(y) }), el("small", { text: `${items.length} 件` })), ol));
  }
  if (!list.length) box.append(el("p", { class: "hist-loading", text: "その曲を演奏したライブは、まだ載っていません。" }));
}

/* ---------- 切り替えと URL ---------- */

function saveUrl() {
  const q = song && songs.has(song) ? `?song=${encodeURIComponent(songs.get(song).title)}` : "";
  history.replaceState(null, "", location.pathname + (view === "nenpyo" ? q : "") + `#${view}`);
}

function setView(v, { scroll = false } = {}) {
  view = VIEWS.includes(v) ? v : "live";
  for (const b of document.querySelectorAll(".sl-tab")) b.setAttribute("aria-selected", String(b.dataset.view === view));
  $("#lives").hidden = view !== "live";
  $("#nenpyo").hidden = view !== "nenpyo";
  saveUrl();
  if (scroll) {
    const top = $(".hist-tabs-bar").getBoundingClientRect().top + scrollY - headerH();
    if (scrollY > top) scrollTo({ top });
  }
}

function setSong(key, { scroll = true } = {}) {
  song = key && songs.has(key) ? key : "";
  $("#songInput").value = song ? songs.get(song).title : "";
  renderSongInfo();
  renderTimeline();
  if (view !== "nenpyo") setView("nenpyo"); else saveUrl();
  if (scroll) scrollTo({ top: $("#nenpyo").getBoundingClientRect().top + scrollY - headerH() - $(".hist-tabs-bar").offsetHeight - 8 });
}

const headerH = () => $("#header").getBoundingClientRect().height;
const scrollToEl = (d) => scrollTo({ top: d.getBoundingClientRect().top + scrollY - headerH() - $(".hist-tabs-bar").offsetHeight - 8 });

$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-view]");
  if (b) setView(b.dataset.view, { scroll: true });
});
// 左右の矢印キーで切り替え
$("#tabs").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  setView(view === "live" ? "nenpyo" : "live");
  document.querySelector(`.sl-tab[data-view="${view}"]`).focus();
});
document.addEventListener("click", (e) => {
  // 曲名を押す → 年表で、その曲のライブだけにする（もう一度押すと解除）
  const b = e.target.closest("[data-song]");
  if (b) { setSong(b.dataset.song === song && view === "nenpyo" ? "" : b.dataset.song, { scroll: b.classList.contains("sl-song") }); return; }
  // 年表のツアー名・日付 → 「ライブ」でそのツアー（と公演）を開く
  const a = e.target.closest("a.sl-to-live");
  if (a) {
    e.preventDefault();
    setView("live");
    const t = document.getElementById(a.dataset.tour);
    t.open = true;
    const l = a.dataset.live && document.getElementById(a.dataset.live);
    if (l && l.tagName === "DETAILS") l.open = true;
    scrollToEl(l || t);
  }
});
// 曲名の欄：候補から選ぶか、名前を入れて検索キー（Enter）
function findSong(text) {
  const k = songKey(text);
  if (!k) return "";
  if (songs.has(k)) return k;
  return [...songs.keys()].find((x) => x.includes(k)) || null;
}
$("#songInput").addEventListener("change", (e) => {
  const k = findSong(e.target.value);
  if (k === null) { song = ""; renderTimeline(); $("#songInfo").replaceChildren(el("p", { class: "sl-song-sub", text: `「${e.target.value}」を演奏したライブは、まだ載っていません。` })); $("#songClear").hidden = false; return; }
  setSong(k, { scroll: false });
});
$("#songClear").addEventListener("click", () => { setSong("", { scroll: false }); $("#songInput").focus(); });

// いちばん上へ戻るボタン
const toTop = $("#toTop");
addEventListener("scroll", () => { toTop.hidden = scrollY < 900; }, { passive: true });
toTop.addEventListener("click", () => scrollTo({ top: 0, behavior: "smooth" }));

// メニュー（ほかのページと同じ動き。ui.js）
setupMenu();
setupBeta($("#main").firstElementChild);
if (hasFeedback) {
  $(".site-footer .footer-links").append(el("a", { href: feedbackUrl({ kind: KIND.error, title: "セットリストの誤りのお知らせ", page: "ライブのセトリ" }), target: "_blank", rel: "noopener noreferrer", text: "セトリの誤りを知らせる ↗" }));
}
if (isAdminDevice()) $("#adminLink").hidden = false;

// 確かさの札の説明
$("#legend").replaceChildren(...SETLIST_CONFIDENCE.map((c) => el("span", {}, badge(c), el("small", { text: c.desc }))));

// 読み込み
(async () => {
  try {
    const res = await fetch("data/setlists.csv", { cache: "no-cache" });
    if (!res.ok) throw new Error();
    const { lives: list, errors } = parseSetlists(await res.text());
    if (errors.length) console.warn("セットリストのデータに、直すところがあります", errors);
    lives = list;
    groupTours();
    indexSongs();
    if (lives.length) $("#span").textContent = `${lives[0].y} — ${lives[lives.length - 1].y}`;
    $("#songList").replaceChildren(...[...songs.values()].map((r) => el("option", { value: r.title })));
    renderLives();
    const q = new URLSearchParams(location.search).get("song");
    song = q ? findSong(q) || "" : "";
    if (song) $("#songInput").value = songs.get(song).title;
    renderSongInfo();
    renderTimeline();
    setView(song && !location.hash ? "nenpyo" : location.hash.slice(1));
  } catch (e) {
    console.error(e);
    $("#loading").textContent = "セットリストを読み込めませんでした。時間をおいて、もう一度開いてください。";
  }
})();
addEventListener("hashchange", () => { if (VIEWS.includes(location.hash.slice(1))) setView(location.hash.slice(1)); });
