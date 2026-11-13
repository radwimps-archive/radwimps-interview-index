// assets/setlist.js
// 「RAD LIVE SET LIST」（ライブのセトリ）のページの動き。データは data/setlists.csv です（ここを書き換えると、このページが変わります）。
// CSV の「ライブ名」が同じ公演は、1つのツアー（またはイベント）としてまとめて表示します。
// 上の切り替えで、2つの見え方を選べます（URL の末尾 #live・#nenpyo でも開けます）。
//   ライブ：ツアーごと。上のボタンで「国内ツアー・海外ツアー・フェス・ボクンチ忘年会・番組出演・単発ライブ」に絞れる（CSV の「区分」）。ツアーを押すと全公演が並び、公演を押すとその日のセットリスト（曲順）が開く。新しいツアーが上
//   年表　：年ごとに、ツアーと、そのツアーで演奏した曲を並べたもの。古いツアーが上。
//           曲名を押すと、その曲を演奏したツアーと日付だけになる（?song=曲名 でも開けます）
//           楽曲一覧（data/songs.csv）があれば、どの公演でも演奏していない曲（ライブで未演奏の曲）も出します
//   ランキング：よく演奏された曲の順位（#ranking）。セトリから自動で数えるので、CSV に公演を足すと順位も変わります。
//           区分（国内ツアーなど）と年代で絞れる。多い順・少ない順を切り替えられる（1回も演奏していない曲は入れない）。曲名を押すと、年表でその曲を演奏したライブだけになる
//   ライブ未演奏：楽曲一覧にあって、どの公演のセトリにも出てこない曲（#unplayed。songs.csv がないときはタブごと出しません）

import { parseCSV, parseSetlists, songKey, SETLIST_CONFIDENCE, SETLIST_CATEGORIES } from "./data.js";
import { h as el, setupMenu, isAdminDevice } from "./ui.js";
import { feedbackUrl, hasFeedback, setupBeta, KIND } from "./feedback.js";
import "./analytics.js";

const $ = (s) => document.querySelector(s);
const VIEWS = ["live", "nenpyo", "ranking", "unplayed"];
const startHash = location.hash; // 開いたときの #live・#nenpyo・#unplayed

let lives = [];          // 公演（古い順）
let tours = [];          // ツアー（古い順）：{ id, name, lives: [公演], y }
let songs = new Map();   // 曲の名前（songKey）→ { title, plays: [{ live, memo }] }
let view = "live";
let cat = "";             // 「ライブ」で選んでいる区分（空なら、すべて）
let song = "";           // 年表で選んでいる曲（songKey）
let rankCat = "";         // ランキングで選んでいる区分（空なら、すべて）
let rankEra = "";         // ランキングで選んでいる年代（"2000" など。空なら、すべての年）
let rankAll = false;      // ランキングを全曲まで出しているか
let rankSong = "";        // ランキングで最後に押した曲（ランキングに戻ったとき、その曲の位置から見られるように）
let rankAsc = false;      // ランキングを少ない順（昇順）に並べるか
let catalog = [];        // 楽曲一覧（data/songs.csv）：{ title, work, y, k }。ないときは空

// 楽曲一覧の曲名と、セトリの曲名を同じものとして比べるための名前
// （「グランドエスケープ feat.三浦透子」→「グランドエスケープ」、‘I’ と 'I' のちがいも同じとみなす）
const catalogKey = (t) => songKey(t.replace(/\s*[(（]?feat\..*$/i, "").replace(/[‘’`]/g, "'"));

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
  for (const t of tours) { t.y = t.lives[0].y; t.cat = t.lives[0].cat; }
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

// 区分の切り替え（すべて・国内ツアー・海外ツアー・フェス・ボクンチ忘年会・番組出演・単発ライブ）
function catChips() {
  const chip = (value, label) => {
    const n = value ? tours.filter((t) => t.cat === value).length : tours.length;
    const b = el("button", { type: "button", class: "chip", "aria-pressed": String(cat === value), disabled: n ? null : "" },
      label, el("span", { class: "n", text: String(n) }));
    b.addEventListener("click", () => { cat = value; renderLives(); $(".sl-cats [aria-pressed=true]")?.focus(); });
    return b;
  };
  return el("div", { class: "chips sl-cats", role: "group", "aria-label": "区分で絞り込む" },
    chip("", "すべて"), ...SETLIST_CATEGORIES.map((c) => chip(c, c)));
}

function renderLives() {
  const box = $("#lives");
  const list = cat ? tours.filter((t) => t.cat === cat) : tours;
  const n = list.reduce((s, t) => s + t.lives.length, 0);
  box.replaceChildren(catChips(), el("p", { class: "hist-view sl-view" }, el("b", { text: cat || "ツアー・ライブごと" }),
    el("span", { text: `${list.length} 件・${n} 公演・新しい順` })));
  [...list].reverse().forEach((t, i) => box.append(tourCard(t, i === 0)));
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

// ライブで未演奏の曲：楽曲一覧にあって、このページのどの公演のセトリにも出てこない曲（発売の古い順）
const playedKeys = () => new Set([...songs.values()].map((r) => catalogKey(r.title)));
const UNPLAYED_NOTE = "楽曲一覧（アルバム・シングル・配信の曲）のうち、このページに載っている公演のセトリに一度も出てこない曲です。フェスやイベントなど、載せていないライブで演奏したことがある曲も入っています。";
function unplayedList() {
  const played = playedKeys();
  return catalog.filter((c) => !played.has(c.k));
}
// 年ごとの曲の並び（年表の欄と「ライブ未演奏」のタブで共通）
function unplayedYears(list) {
  const years = new Map();
  for (const c of list) (years.get(c.y) || years.set(c.y, []).get(c.y)).push(c);
  return [...years].map(([y, cs]) => el("div", { class: "sl-unplayed-year" },
    el("span", { class: "sl-unplayed-y", text: y || "" }),
    el("ul", { class: "sl-unplayed-list" }, ...cs.map((c) => el("li", {}, c.title, c.work && c.work !== c.title ? el("small", { text: `（${c.work}）` }) : null)))));
}
function renderUnplayed() {
  const box = $("#unplayed"), panel = $("#unplayedBody"), tab = $("#tabUnplayed");
  if (!catalog.length) { box.hidden = true; tab.hidden = true; return; }
  const list = unplayedList();
  // 年表の中の、開いたり閉じたりする欄
  box.replaceChildren(
    el("summary", {}, el("b", { text: "ライブで未演奏の曲" }), el("small", { text: ` ${list.length} 曲（全 ${catalog.length} 曲のうち）` })),
    el("p", { class: "sl-song-sub", text: UNPLAYED_NOTE }),
    ...unplayedYears(list));
  box.hidden = false;
  // 「ライブ未演奏」のタブ
  panel.replaceChildren(
    el("p", { class: "sl-unplayed-head" }, el("b", { text: `${list.length} 曲` }), `（全 ${catalog.length} 曲のうち）・発売の古い順`),
    el("p", { class: "sl-song-sub", text: UNPLAYED_NOTE }),
    ...unplayedYears(list));
  tab.hidden = false;
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

/* ---------- ランキング：よく演奏された曲 ---------- */

const RANK_TOP = 30; // はじめに出す曲の数（「すべて見る」で全曲）
const eraOf = (l) => String(Math.floor(l.y / 10) * 10);

// 選んだ区分・年代の公演（セトリがあるものだけ）で、曲ごとに何公演で演奏したかを数える
function rankRows() {
  const target = lives.filter((l) => hasSongs(l) && (!rankCat || l.cat === rankCat) && (!rankEra || eraOf(l) === rankEra));
  const m = new Map();
  for (const l of target) {
    for (const k of new Set(songsOf(l).map((s) => songKey(s.title)))) {
      const r = m.get(k) || m.set(k, { k, title: songs.get(k).title, n: 0, last: l }).get(k);
      r.n++; r.last = l;
    }
  }
  const rows = [...m.values()].sort((a, b) => b.n - a.n || a.title.localeCompare(b.title, "ja"));
  // 同じ回数は同じ順位（1, 2, 2, 4 …）
  rows.forEach((r, i) => { r.rank = i && rows[i - 1].n === r.n ? rows[i - 1].rank : i + 1; });
  return { rows, total: target.length };
}

function rankChips(label, values, current, set) {
  const g = el("div", { class: "chips sl-cats", role: "group", "aria-label": label });
  for (const [v, text] of values) {
    const b = el("button", { type: "button", class: "chip", "aria-pressed": String(current === v) }, text);
    b.addEventListener("click", () => { set(v); rankAll = false; renderRanking(); g.querySelector("[aria-pressed=true]")?.focus(); });
    g.append(b);
  }
  return g;
}

function renderRanking() {
  const box = $("#ranking");
  const eras = [...new Set(lives.filter(hasSongs).map(eraOf))].sort();
  const { rows, total } = rankRows();
  const max = rows[0]?.n || 1;
  // 少ない順：回数の少ない曲から（同じ回数は曲名順）。0回の曲は、もともと数に入らないので出ません
  const ordered = rankAsc ? [...rows].sort((a, b) => a.n - b.n || a.title.localeCompare(b.title, "ja")) : rows;
  const cut = ordered[Math.min(RANK_TOP, ordered.length) - 1];
  // はじめは30曲まで（30曲目と同じ回数の曲は、あわせて出します）
  const shown = rankAll || !cut ? ordered : ordered.filter((r) => (rankAsc ? r.n <= cut.n : r.n >= cut.n));
  const ol = el("ol", { class: "sl-rank" });
  for (const r of shown) {
    const bar = el("span", { class: "sl-rank-bar", "aria-hidden": "true" }, el("span", {}));
    bar.firstChild.style.width = `${(r.n / max) * 100}%`; // 回数の長さ（いちばん多い曲を 100%）
    ol.append(el("li", { class: "sl-rank-row" + (r.rank <= 3 ? " top" : "") + (r.k === rankSong ? " last" : "") },
      el("span", { class: "sl-rank-no", text: String(r.rank) }),
      el("span", { class: "sl-rank-main" },
        el("button", { type: "button", class: "sl-song", "data-song": r.k, title: `「${r.title}」を演奏したライブを年表で見る` }, r.title),
        bar),
      el("span", { class: "sl-rank-n" }, el("b", { text: String(r.n) }), " 公演", el("small", { text: `${Math.round((r.n / total) * 100)}%` }))));
  }
  box.replaceChildren(
    rankChips("区分で絞り込む", [["", "すべて"], ...SETLIST_CATEGORIES.map((c) => [c, c])], rankCat, (v) => { rankCat = v; }),
    rankChips("年代で絞り込む", [["", "すべての年"], ...eras.map((e) => [e, `${e}年代`])], rankEra, (v) => { rankEra = v; }),
    rankChips("並び順", [[false, "多い順"], [true, "少ない順"]], rankAsc, (v) => { rankAsc = v; }),
    el("p", { class: "hist-view sl-view" }, el("b", { text: [rankCat || "すべて", rankEra ? `${rankEra}年代` : ""].filter(Boolean).join("・") }),
      el("span", { text: total ? `セトリがある ${total} 公演・${rows.length} 曲` : "セトリがある公演は、まだありません" })),
    el("p", { class: "sl-song-sub", text: "数字は、その曲を演奏した公演の数です（1つの公演で2回やっても1回。1回も演奏していない曲は入れていません）。% は、セトリがある公演のうち何割で演奏したか。曲名を押すと、その曲を演奏したライブが年表で並びます。" }),
    ol);
  if (shown.length < rows.length) {
    const more = el("button", { type: "button", class: "sl-clear sl-rank-more", text: `すべて見る（${rows.length} 曲）` });
    more.addEventListener("click", () => { rankAll = true; renderRanking(); });
    box.append(more);
  }
}

/* ---------- 切り替えと URL ---------- */

function saveUrl() {
  const q = song && songs.has(song) ? `?song=${encodeURIComponent(songs.get(song).title)}` : "";
  history.replaceState(null, "", location.pathname + (view === "nenpyo" ? q : "") + `#${view}`);
}

function setView(v, { scroll = false } = {}) {
  view = VIEWS.includes(v) && !(v === "unplayed" && !catalog.length) ? v : "live";
  for (const b of document.querySelectorAll(".sl-tab")) b.setAttribute("aria-selected", String(b.dataset.view === view));
  $("#lives").hidden = view !== "live";
  $("#nenpyo").hidden = view !== "nenpyo";
  $("#ranking").hidden = view !== "ranking";
  $("#unplayedView").hidden = view !== "unplayed";
  saveUrl();
  // ランキングに戻ったときは、前に押した曲の位置へ
  const last = view === "ranking" && rankSong && $("#ranking .sl-rank-row.last");
  if (last) { scrollTo({ top: last.getBoundingClientRect().top + scrollY - headerH() - $(".hist-tabs-bar").offsetHeight - 16 }); return; }
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
  const vs = [...document.querySelectorAll(".sl-tab:not([hidden])")].map((b) => b.dataset.view);
  setView(vs[(vs.indexOf(view) + (e.key === "ArrowRight" ? 1 : vs.length - 1)) % vs.length]);
  document.querySelector(`.sl-tab[data-view="${view}"]`).focus();
});
document.addEventListener("click", (e) => {
  // 曲名を押す → 年表で、その曲のライブだけにする（もう一度押すと解除）
  const b = e.target.closest("[data-song]");
  if (b && b.closest("#ranking")) {
    // ランキングで押した曲を覚えて、印をつける
    rankSong = b.dataset.song;
    for (const r of document.querySelectorAll("#ranking .sl-rank-row")) r.classList.toggle("last", r.contains(b));
  }
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
  if (k === null) {
    song = ""; renderTimeline();
    const c = catalog.find((x) => x.k === catalogKey(e.target.value));
    $("#songInfo").replaceChildren(el("p", { class: "sl-song-sub", text: c ? `「${c.title}」（${[c.y ? `${c.y}年` : "", c.work].filter(Boolean).join("・")}）は、ここに載っているライブでは、まだ演奏されていません。` : `「${e.target.value}」を演奏したライブは、まだ載っていません。` }));
    $("#songClear").hidden = false; return;
  }
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

// 楽曲一覧（data/songs.csv）を読む。読めないときは「ライブで未演奏の曲」を出さない
async function loadCatalog() {
  try {
    const res = await fetch("data/songs.csv", { cache: "no-cache" });
    if (!res.ok) return;
    const { rows } = parseCSV(await res.text());
    const head = rows[0] || [], ci = (n) => head.indexOf(n);
    const [iT, iW, iY] = [ci("曲名"), ci("初めて出た作品"), ci("年")];
    if (iT < 0) return;
    catalog = rows.slice(1).filter((r) => (r[iT] || "").trim()).map((r) => {
      const title = r[iT].trim();
      return { title, work: (r[iW] || "").trim(), y: +(r[iY] || 0) || 0, k: catalogKey(title) };
    }).sort((a, b) => a.y - b.y);
    renderUnplayed();
    // URL が #unplayed のときは、楽曲一覧を読んでから開く
    if (startHash === "#unplayed" && view === "live") setView("unplayed");
  } catch (e) { console.warn("楽曲一覧を読み込めませんでした", e); }
}

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
    renderRanking();
    const q = new URLSearchParams(location.search).get("song");
    song = q ? findSong(q) || "" : "";
    if (song) $("#songInput").value = songs.get(song).title;
    renderSongInfo();
    renderTimeline();
    loadCatalog();
    setView(song && !location.hash ? "nenpyo" : location.hash.slice(1));
  } catch (e) {
    console.error(e);
    $("#loading").textContent = "セットリストを読み込めませんでした。時間をおいて、もう一度開いてください。";
  }
})();
addEventListener("hashchange", () => { if (VIEWS.includes(location.hash.slice(1))) setView(location.hash.slice(1)); });
