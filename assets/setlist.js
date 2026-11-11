// assets/setlist.js
// 「ライブのセトリ」のページの動き。データは data/setlists.csv です（ここを書き換えると、このページが変わります）。
// 上の切り替えで、2つの見え方を選べます（URL の末尾 #live・#nenpyo でも開けます）。
//   ライブ：公演ごとのセットリスト（曲順）。新しい公演が上
//   年表　：年ごとに、公演と演奏した曲を並べたもの。古い公演が上。曲名を押すと、その曲を演奏した公演だけになる（?song=曲名 でも開けます）

import { parseSetlists, songKey, SETLIST_CONFIDENCE } from "./data.js";
import { h as el, setupMenu, isAdminDevice } from "./ui.js";
import { feedbackUrl, hasFeedback, setupBeta, KIND } from "./feedback.js";

const $ = (s) => document.querySelector(s);
const VIEWS = ["live", "nenpyo"];

let lives = [];          // 公演（古い順）
let songs = new Map();   // 曲の名前（songKey）→ { title, plays: [{ live, n, encore, memo }] }
let view = "live";
let song = "";           // 年表で選んでいる曲（songKey）

const pad = (n) => String(n).padStart(2, "0");
const dateLabel = (l) => (l.d ? `${l.y}.${pad(l.m)}.${pad(l.d)}` : l.m ? `${l.y}.${pad(l.m)}` : String(l.y));
const songCount = (l) => l.main.length + l.encore.length;

// 曲ごとの記録を作る（同じ公演で2回やった曲は、1公演として数える）
function indexSongs() {
  songs = new Map();
  for (const l of lives) {
    [...l.main, ...l.encore].forEach((s, i) => {
      const k = songKey(s.title);
      const rec = songs.get(k) || songs.set(k, { title: s.title, plays: [] }).get(k);
      if (!rec.plays.some((p) => p.live === l)) rec.plays.push({ live: l, n: i + 1, encore: i >= l.main.length, memo: s.memo });
    });
  }
}

const badge = (c) => el("span", { class: `sl-conf conf-${c.slug}`, title: c.desc, text: c.label });

/* ---------- ライブ：公演ごとのセットリスト ---------- */

function songItem(s, n) {
  return el("li", { value: String(n) },
    el("button", { type: "button", class: "sl-song", "data-song": songKey(s.title), title: `「${s.title}」を演奏したライブを年表で見る` }, s.title),
    s.memo ? el("small", { class: "sl-memo", text: s.memo }) : null);
}

function liveCard(l, open) {
  const details = el("details", { class: "sl-live", id: `live-${l.date}-${l.i}`, open: open || null },
    el("summary", {},
      el("p", { class: "hist-meta" }, el("time", { datetime: l.date, text: dateLabel(l) }), badge(l.conf)),
      el("h2", { class: "sl-live-name", text: l.name }),
      el("p", { class: "sl-live-venue" }, l.venue || "", el("span", { class: "sl-count", text: `${songCount(l)}曲` }))));
  const body = el("div", { class: "sl-live-body" });
  body.append(el("ol", { class: "sl-songs" }, ...l.main.map((s, i) => songItem(s, i + 1))));
  if (l.encore.length) {
    body.append(el("h3", { class: "sl-encore", text: "アンコール" }),
      el("ol", { class: "sl-songs" }, ...l.encore.map((s, i) => songItem(s, l.main.length + i + 1))));
  }
  const info = el("dl", { class: "sl-info" });
  const row = (k, v) => v && info.append(el("dt", { text: k }), el("dd", {}, v));
  row("ゲスト", l.guests.join("・"));
  row("メモ", l.note);
  row("確かさ", l.conf.desc);
  row("出典", l.url ? el("a", { href: l.url, target: "_blank", rel: "noopener noreferrer", text: `${l.source || "出典"} ↗` }) : l.source);
  body.append(info);
  details.append(body);
  return details;
}

function renderLives() {
  const box = $("#lives");
  box.replaceChildren(el("p", { class: "hist-view sl-view" }, el("b", { text: "公演ごとのセットリスト" }), el("span", { text: `${lives.length} 公演・新しい順` })));
  const list = [...lives].reverse();
  list.forEach((l, i) => box.append(liveCard(l, i === 0)));
}

/* ---------- 年表：年ごとの公演と曲 ---------- */

function renderSongInfo() {
  const box = $("#songInfo");
  box.replaceChildren();
  $("#songClear").hidden = !song;
  if (song && songs.has(song)) {
    const rec = songs.get(song), first = rec.plays[0].live, last = rec.plays[rec.plays.length - 1].live;
    box.append(
      el("p", { class: "sl-song-head" }, el("b", { text: `「${rec.title}」` }), `を演奏したライブ：${rec.plays.length} / ${lives.length} 公演`),
      el("p", { class: "sl-song-sub", text: `ここに載っている中で、いちばん早いのは ${dateLabel(first)}「${first.name}」` + (last !== first ? `、いちばん新しいのは ${dateLabel(last)}「${last.name}」` : "") + "。" }));
    return;
  }
  // 曲を選んでいないときは、よく演奏された曲を並べる
  const top = [...songs.entries()].sort((a, b) => b[1].plays.length - a[1].plays.length || a[1].plays[0].live.i - b[1].plays[0].live.i).slice(0, 12);
  box.append(el("p", { class: "sl-song-sub", text: `ここに載っている ${lives.length} 公演で、よく演奏された曲（押すと、その曲の公演だけになります）` }),
    el("div", { class: "sl-chips" }, ...top.map(([k, r]) => el("button", { type: "button", class: "sl-chip", "data-song": k }, r.title, el("small", { text: ` ${r.plays.length}` })))));
}

function renderTimeline() {
  const box = $("#timeline");
  box.replaceChildren();
  const rec = song ? songs.get(song) : null;
  const list = rec ? rec.plays.map((p) => p.live) : lives;
  const years = new Map();
  for (const l of list) (years.get(l.y) || years.set(l.y, []).get(l.y)).push(l);
  for (const [y, items] of years) {
    const ol = el("ol", { class: "hist-list" });
    for (const l of items) {
      const chips = el("div", { class: "sl-chips" });
      [...l.main, ...l.encore].forEach((s, i) => {
        const k = songKey(s.title);
        if (i === l.main.length) chips.append(el("span", { class: "sl-enc-mark", text: "アンコール" }));
        chips.append(el("button", { type: "button", class: "sl-chip" + (k === song ? " on" : ""), "data-song": k, "aria-pressed": String(k === song), title: s.memo || null }, s.title));
      });
      ol.append(el("li", { class: "hist-item cat-live" },
        el("p", { class: "hist-meta" }, el("time", { datetime: l.date, text: dateLabel(l) }), badge(l.conf)),
        el("p", { class: "hist-title" }, el("a", { href: `#live-${l.date}-${l.i}`, class: "sl-to-live", "data-live": `live-${l.date}-${l.i}`, text: l.name })),
        el("p", { class: "hist-sub", text: [l.venue, `${songCount(l)}曲`].filter(Boolean).join(" ／ ") }),
        chips));
    }
    box.append(el("section", { class: "hist-year", id: `y${y}`, "aria-labelledby": `yh${y}` },
      el("h2", { id: `yh${y}`, class: "hist-year-head" }, el("span", { text: String(y) }), el("small", { text: `${items.length} 公演` })), ol));
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
// 曲名を押す → 年表で、その曲の公演だけにする（もう一度押すと解除）
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-song]");
  if (b) { setSong(b.dataset.song === song && view === "nenpyo" ? "" : b.dataset.song, { scroll: b.classList.contains("sl-song") }); return; }
  // 年表のライブ名 → 「ライブ」でその公演を開く
  const a = e.target.closest("a.sl-to-live");
  if (a) {
    e.preventDefault();
    setView("live");
    const d = document.getElementById(a.dataset.live);
    d.open = true;
    scrollTo({ top: d.getBoundingClientRect().top + scrollY - headerH() - $(".hist-tabs-bar").offsetHeight - 8 });
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
