// assets/setlist.js
// 「RAD LIVE SET LIST」（ライブのセトリ）のページの動き。データは data/setlists.csv です（ここを書き換えると、このページが変わります）。
// CSV の「ライブ名」が同じ公演は、1つのツアー（またはイベント）としてまとめて表示します。
// 上のタブ（すき間なく並ぶ。左右にスクロールできる）で、見え方を選べます（URL の末尾 #mine・#live・#ranking・#unplayed でも開けます（古い #nenpyo は #live として開きます）。はじめは「ライブ」）。
//   参加公演：行ったライブ（公演の足あとのアイコンを押したもの）の、ライブ名と公演日だけ。印は「RADWIMPSの歩み」と連動（attended.js）
// 公演（日付・会場）の「行った」ボタン：行ったことのあるライブの印（ブックマーク）。「RADWIMPSの歩み」と同じ印で、連動します（attended.js）。
//   ライブ：ツアーごと。「区分」のメニューで「国内ツアー・海外ツアー・フェス・ボクンチ忘年会・番組出演・単発ライブ」に絞れる（CSV の「区分」）。ツアーを押すと全公演が並び、公演を押すとその日のセットリスト（曲順）が開く。新しいツアーが上
//           年ごとに見出しがつき、上の年のボタンで、その年へ飛べる。曲名を押すと、その曲を演奏したツアーだけになる（?song=曲名 でも開けます。「絞り込みを解除」で戻る）
//   ランキング：よく演奏された曲の順位（#ranking）。セトリから自動で数えるので、CSV に公演を足すと順位も変わります。
//           楽曲一覧（data/songs.csv）にない曲（未発表の曲・カバー・映画の劇伴など）は入れない。区分（国内ツアーなど）と年代で絞れる。多い順・少ない順を切り替えられる（1回も演奏していない曲は入れない）。曲名を押すと、「ライブ」でその曲を演奏したライブだけになる
//   ライブ未演奏：楽曲一覧にあって、どの公演のセトリにも出てこない曲（#unplayed。songs.csv がないときはタブごと出しません）
// 「RADWIMPSの歩み」とのつながり（運営の希望 11/23。歩みの年表の管理で直したものが、ここにも出る）：
//   年表（data/history.csv）と特設サイトの一覧（data/sites.csv）も読み、ライブ・ツアーの出来事に入る公演（data.js の historyShows。歩みと同じ決まり）のツアーに、
//   その出来事の特設サイト・公式ページ、関連リンク（記事一覧の記事・ほかのページ）、動画（ライブ映像など）を出し、出来事に付けたタグでも検索で見つかるようにする。
//   セトリを先に出し、年表・特設サイトの一覧（と、関連リンクに記事があれば記事データ）が届いたら足す。読めなくても、このページはそのまま使える

import { parseCSV, parseSetlists, parseHistory, parseSites, parseArticles, linkHistorySites, historyShows, historySiteLinks, historyLinkItems, historyTagIndex, tagsForNames, tagSearchWords, siteKey, songKey, SETLIST_CONFIDENCE, SETLIST_CATEGORIES } from "./data.js";
import { h as el, setupMenu, isAdminDevice, watchScrollFade, watchStuck } from "./ui.js";
import { feedbackUrl, hasFeedback, setupBeta, KIND } from "./feedback.js";
import { looseMatch, looseMatchAll, fold } from "./search.js";
import { attended, attendButton, attendCount, assignKeys, sync as syncAttend, setupAttendClicks } from "./attended.js";
import "./analytics.js";

const $ = (s) => document.querySelector(s);
const VIEWS = ["mine", "live", "ranking", "unplayed"];
const VIEW_ALIAS = { nenpyo: "live" }; // 昔の #nenpyo（年表）は、「ライブ」に統合した
const startHash = location.hash; // 開いたときの #live・#unplayed

let lives = [];          // 公演（古い順）
let tours = [];          // ツアー（古い順）：{ id, name, lives: [公演], y }
let songs = new Map();   // 曲の名前（songKey）→ { title, plays: [{ live, memo }] }
let view = "live";
let songMissing = ""; // ?song= に書かれた曲が見つからなかったときの、その言葉
let song = "";           // 「ライブ」で絞り込んでいる曲（songKey）
let rankAll = false;      // ランキングを全曲まで出しているか
let rankSong = "";        // ランキングで最後に押した曲（ランキングに戻ったとき、その曲の位置から見られるように）
let catalog = [];        // 楽曲一覧（data/songs.csv）：{ title, work, y, k }。ないときは空

// 楽曲一覧の曲名と、セトリの曲名を同じものとして比べるための名前
// （「グランドエスケープ feat.三浦透子」→「グランドエスケープ」、‘I’ と 'I' のちがいも同じとみなす）
// 「〜」（波ダッシュ）と「～」（全角チルダ）は見た目が同じなので、同じ曲として比べる
const catalogKey = (t) => songKey(t.replace(/\s*[(（]?feat\..*$/i, "").replace(/[‘’`]/g, "'").replace(/[〜～~]/g, "~"));

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
// 歩みの出来事をツアーにつなぐ：t.hist に出来事（特設サイト・タグを持つ）を入れる
function attachHistory(historyText, sitesText) {
  if (!historyText) return;
  const sites = sitesText ? parseSites(sitesText).sites : [];
  const events = linkHistorySites(parseHistory(historyText).events, sites);
  tagIndex = historyTagIndex(events);
  for (const e of events) {
    for (const l of historyShows(e, lives)) {
      const t = l.tour;
      if (t && !(t.hist ||= []).includes(e)) t.hist.push(e);
    }
  }
}
// タグの共通化：ツアー名と同じ名前（「」の中）の出来事に付けたタグでも、ツアーが見つかる（data.js の historyTagIndex）
let tagIndex = null;
// 関連リンクの記事（data/articles.csv の公開している記事。id → 記事）。関連リンクに記事があるときだけ読む
let articleById = new Map();
// ツアーを開いたところに出す、歩みの出来事のリンク（新しいタブで開く）：
//   1行目：特設サイト・公式ページ　2行目：関連リンク（記事・ほかのページ）と動画（ライブ映像など）
function histLines(t) {
  const ev = t.hist || [];
  if (!ev.length) return null;
  const row = (cls, items) => {
    if (!items.length) return null;
    const p = el("p", { class: `hist-sites ${cls}` });
    items.forEach((a, i) => { if (i) p.append(el("span", { class: "sep", "aria-hidden": "true", text: "·" })); p.append(a); });
    return p;
  };
  const seen = new Set();
  const once = (href) => { const k = siteKey(href) || href; if (seen.has(k)) return false; seen.add(k); return true; };
  const sites = ev.flatMap(historySiteLinks).filter((x) => once(x.href)).map((x) =>
    el("a", { href: x.href, target: "_blank", rel: "noopener noreferrer", "aria-label": `${x.name || t.name}の${x.label}を新しいタブで開く` }, `${x.label} ↗`));
  const rel = ev.flatMap((e) => historyLinkItems(e, articleById)).filter((x) => once(x.href)).map((x) => x.kind
    ? el("a", { href: x.href, target: "_blank", rel: "noopener noreferrer", "aria-label": `${x.kind}「${x.title}」（${x.media}）を新しいタブで開く` },
      el("span", { class: "hist-link-kind", text: x.kind }), `${x.title} ↗`)
    : el("a", { href: x.href, target: "_blank", rel: "noopener noreferrer", "aria-label": `${x.title}（新しいタブで開く）` }, `${x.title} ↗`));
  const vids = ev.flatMap((e) => e.videos || []).filter((v) => once(`https://www.youtube.com/watch?v=${v.id}`)).map((v) =>
    el("a", { href: `https://www.youtube.com/watch?v=${v.id}`, target: "_blank", rel: "noopener noreferrer", "aria-label": `${v.label}を YouTube で見る（新しいタブで開く）` }, `▶ ${v.label}`));
  const lines = [row("sl-sites", sites), row("hist-links sl-rel", [...rel, ...vids])].filter(Boolean);
  return lines.length ? el("div", { class: "sl-hist" }, ...lines) : null;
}
// 年表などがあとから届いたとき：表示中のツアーに、歩みのリンクの行を足し直す（開いている公演や位置はそのまま）
function patchHistLines() {
  for (const t of tours) {
    const card = document.getElementById(t.id);
    if (!card) continue;
    card.querySelector(":scope > .sl-hist")?.remove();
    const lines = histLines(t);
    if (lines) card.querySelector(":scope > summary").after(lines);
  }
}
// 年表・特設サイトの一覧を読んでツアーにつなぎ、関連リンクに記事があれば記事データも読む（8 秒で届かなければあきらめる）
function loadHistory() {
  const opt = (f) => fetch(f, { cache: "no-cache", signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined })
    .then((r) => (r.ok ? r.text() : "")).catch(() => "");
  Promise.all([opt("data/history.csv"), opt("data/sites.csv")]).then(async ([historyText, sitesText]) => {
    try { attachHistory(historyText, sitesText); } catch (e) { console.warn("歩みの年表をつなげませんでした", e); return; }
    for (const t of tours) t.hayN = null; // 検索の文字に、タグを入れ直す
    patchHistLines();
    // 検索中なら、タグでも見つかるように探し直す（カードの中のボタンを操作している最中は、位置が飛ばないよう、次に文字を打ったときに任せる）
    const busy = document.activeElement?.closest?.("#lives, #mine");
    if (!busy && queries.live.trim()) renderLives();
    if (!busy && queries.mine.trim()) renderMine();
    if (tours.some((t) => (t.hist || []).some((e) => (e.links || []).some((l) => l.type === "article")))) {
      const text = await opt("data/articles.csv");
      if (!text) return;
      try { articleById = new Map(parseArticles(text).items.filter((it) => it.state === "公開" && it.url).map((it) => [it.id, it])); } catch { return; }
      patchHistLines();
    }
  });
}

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

// 歌った人の見出し（【kZm】など）がある公演は、人ごとに曲順の番号を数え直す
function songLists(list, from = 0) {
  const out = [];
  let ol = null, part = null, n = 0;
  list.forEach((s, i) => {
    if (!ol || (s.part || "") !== part) {
      const firstGroup = !ol;
      part = s.part || "";
      if (part) out.push(el("h4", { class: "sl-part", text: part }));
      ol = el("ol", { class: "sl-songs" });
      out.push(ol);
      // 【アンコール1】【アンコール2】は、番号を続けて数える（ほかの出演者の見出しの下は 1 から）
      n = /^アンコール/.test(part) ? (firstGroup ? from : n) : part ? 0 : from;
    }
    ol.append(songItem(s, ++n));
  });
  return out;
}

function songItem(s, n) {
  return el("li", { value: String(n), class: song && songKey(s.title) === song ? "sl-song-hit" : null },
    el("button", { type: "button", class: "sl-song", "data-song": songKey(s.title), "aria-current": song && songKey(s.title) === song ? "true" : null, title: `「${s.title}」を演奏したライブだけを見る` }, s.title),
    s.memo ? el("small", { class: "sl-memo", text: s.memo }) : null);
}

// 1公演のセットリストと、出典など
function setlistBody(l) {
  const body = el("div", { class: "sl-live-body" });
  if (!hasSongs(l)) body.append(el("p", { class: "sl-none", text: "この公演のセットリストは、まだ確かめられていません。" }));
  else {
    body.append(...songLists(l.main));
    if (l.encore.length) {
      // 【アンコール1】などの見出しがあるときは、外側の「アンコール」の見出しは出さない（重なるので）
      body.append(/^アンコール/.test(l.encore[0].part || "") ? "" : el("h4", { class: "sl-encore", text: "アンコール" }),
        ...songLists(l.encore, l.main.some((s) => s.part) ? 0 : l.main.length));
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
      el("span", { class: "sl-show-meta" }, hasSongs(l) ? `${songsOf(l).length}曲` : "", badge(l.conf)),
      attendButton(l)),
    setlistBody(l));
}

function tourCard(t, open, openIds, played) {
  // 曲で絞り込んでいるときは、その曲を演奏した公演だけ
  const ls = played ? t.lives.filter((l) => played.has(l)) : t.lives;
  const n = ls.length, withSongs = ls.filter(hasSongs).length;
  const one = t.lives.length === 1 ? ls[0] : null;
  const card = el("details", { class: "sl-live", id: t.id, open: open || null },
    el("summary", {},
      el("p", { class: "hist-meta" }, el("time", { text: periodLabel(t) }), one ? badge(one.conf) : null, one ? attendButton(one) : null),
      el("h3", { class: "sl-live-name", text: t.name }),
      el("p", { class: "sl-live-venue" },
        one ? (one.venue || "") : played ? "" : `${n}公演`,
        el("span", { class: "sl-count", text: one ? (hasSongs(one) ? `${songsOf(one).length}曲` : "セトリ未確認") : played ? `演奏 ${n}／${t.lives.length} 公演` : `セトリあり ${withSongs}／${n}` }),
        one ? null : attendCount(ls))));
  const hist = histLines(t);
  if (hist) card.append(hist);
  if (one) { const b = setlistBody(one); b.id = liveId(one); card.append(b); }
  else card.append(el("div", { class: "sl-shows" }, ...ls.map((l) => showRow(l, !!openIds?.has(liveId(l))))));
  return card;
}

/* ---------- 検索窓（どのタブでも。タブごとに入れた言葉を覚える） ---------- */

const queries = { mine: "", live: "", ranking: "", unplayed: "" };
const PLACEHOLDERS = {
  mine: "行ったライブを、ライブ名・会場・曲名で探す", live: "ライブ名・会場・曲名で探す",
  ranking: "曲名で探す", unplayed: ""
};
// ツアー・ライブが検索の言葉に合うか。ライブ名・会場・日付はゆるく（ひらがなでも英名に合う）、曲名・ゲストは文字をそろえて探す
function hitTour(t, query) {
  const parts = String(query || "").normalize("NFKC").split(/\s+/).filter(Boolean);
  if (!parts.length) return true;
  // 歩みの出来事に付けたタグ（「#」付きでも探せる）も、ライブ名と同じくゆるく比べる
  const names = t.hayN || (t.hayN = [t.name, ...t.lives.flatMap((l) => [l.venue, dateLabel(l)]),
    ...(t.hist || []).flatMap((e) => (e.tags || []).flatMap((x) => [x, `#${x}`])), tagSearchWords(tagsForNames(tagIndex, [t.name]))].join(" "));
  const inner = t.hayS || (t.hayS = fold(t.lives.flatMap((l) => [...songsOf(l).map((s) => s.title), ...l.guests, ...l.main.map((s) => s.part || "")]).join(" ")));
  const one = (p) => looseMatch(names, p) || (fold(p) !== "" && inner.includes(fold(p)));
  const whole = fold(query);
  return looseMatch(names, query) || (whole !== "" && inner.includes(whole)) || parts.every(one);
}
// 並び順のボタン（「新しい順 ⇅」など。押すたびに逆になる）。desc＝新しい順・多い順、asc＝古い順・少ない順
const sortState = { mine: "desc", live: "desc", ranking: "desc" };
const SORT_LABELS = { mine: ["新しい順", "古い順"], live: ["新しい順", "古い順"], ranking: ["多い順", "少ない順"] };
const isAsc = (v) => sortState[v] === "asc";
const VIEW_BOX = { mine: "#mine", live: "#lives", ranking: "#ranking" };
// 作り直したあと、前に押していたボタン（同じ selector のもの）へ、キーボードの位置を戻す
function refocus(v, selector) {
  const b = $(`${VIEW_BOX[v]} ${selector}`);
  if (b) b.focus({ preventScroll: true });
}
function sortButton(v, rerender) {
  const label = SORT_LABELS[v][isAsc(v) ? 1 : 0];
  const b = el("button", { type: "button", class: "sl-sort", "aria-label": `並び順を切り替える（いまは${label}）` }, label, el("span", { class: "sl-sort-arrow", "aria-hidden": "true", text: "⇅" }));
  b.addEventListener("click", () => { sortState[v] = isAsc(v) ? "desc" : "asc"; if (v === "ranking") rankAll = false; rerender(); refocus(v, ".sl-sort"); });
  return b;
}
const noHit = (q) => el("p", { class: "sl-mine-empty", text: `「${q}」に合うものは、見つかりませんでした。ひらがなや英語、ライブ名の一部でも探せます。` });

// 曲で絞り込んでいるときの、上の案内（「絞り込みを解除」で戻る）
function songBanner(rec, cats) {
  const first = rec.plays[0].live, last = rec.plays[rec.plays.length - 1].live;
  const nTours = new Set(rec.plays.map((p) => p.live.tour)).size;
  return el("div", { class: "sl-song-info", "aria-live": "polite" },
    el("p", { class: "sl-song-head" }, el("b", { text: `「${rec.title}」` }), `を演奏したライブ：${rec.plays.length} 公演（${nTours} ツアー・ライブ）`),
    el("p", { class: "sl-song-sub", text: `ここに載っている中で、いちばん早いのは ${dateLabel(first)}「${first.name}」` + (last !== first ? `、いちばん新しいのは ${dateLabel(last)}「${last.name}」` : "") + "。セトリを確かめられた公演だけを数えています。下には、この曲を演奏した公演だけを出し、セトリの中のこの曲に色をつけています。" + (cats.size ? `いまは区分（${[...cats].join("・")}）で絞っているので、下の一覧と見出しの行の数は、その区分のライブだけです。` : "") }),
    el("button", { type: "button", class: "sl-song-clear", "data-song": song, text: "絞り込みを解除" }));
}

// ライブ：年ごとに見出しをつけて、ツアー・ライブを並べる（押すと、公演とセットリストが開く）
// 区分（国内ツアー・海外ツアー・フェスなど）で絞り込むメニュー。1つ選ぶ（「すべての区分」で解除）。「ライブ」と「ランキング」で、別々に覚える
const catState = { live: new Set(), ranking: new Set() };
function catBar(v, counts, rerender, unit) {
  const set = catState[v];
  if (set.size > 1) { const [c] = set; set.clear(); set.add(c); } // 以前の URL などで複数選ばれていたら、最初の1つにする
  const now = [...set][0] || "";
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const sel = el("select", { class: "sl-cat-select", "aria-label": "区分で絞り込む" },
    el("option", { value: "", text: `すべての区分（${total}${unit}）` }),
    ...SETLIST_CATEGORIES.filter((c) => counts[c] || set.has(c)).map((c) => el("option", { value: c, text: `${c}（${counts[c] || 0}${unit}）` })));
  sel.value = now;
  sel.addEventListener("change", () => {
    set.clear();
    if (sel.value) set.add(sel.value);
    if (v === "ranking") rankAll = false;
    rerender();
    if (v === "live") saveUrl(); // いまの区分を履歴にも覚えておく
    refocus(v, ".sl-cat-select"); // 作り直したメニューに、フォーカスを戻す
  });
  return el("div", { class: "sl-cats" }, sel);
}
const countBy = (items) => { const m = {}; for (const x of items) if (x.cat) m[x.cat] = (m[x.cat] || 0) + 1; return m; };

function renderLives() {
  queueMicrotask(() => syncAttend());
  const box = $("#lives");
  const q = queries.live;
  const rec = song ? songs.get(song) : null;
  const cats = catState.live;
  const songTours = rec ? tours.filter((t) => rec.plays.some((p) => p.live.tour === t)) : tours;
  const base = songTours.filter((t) => !cats.size || cats.has(t.cat));
  const list = base.filter((t) => hitTour(t, q));
  const played = rec ? new Set(rec.plays.map((p) => p.live)) : null;
  const n = list.reduce((s, t) => s + (played ? t.lives.filter((l) => played.has(l)).length : t.lives.length), 0);
  // 作り直す前に開いていたツアー・公演（はじめて描くときは、いちばん上だけ開く）
  const openIds = box.querySelector(".sl-live") ? new Set([...box.querySelectorAll("details[open][id]")].map((d) => d.id)) : null;
  box.replaceChildren(el("p", { class: "hist-view sl-view" }, el("b", { text: rec ? "その曲を演奏したライブ" : "ツアー・ライブごと" }),
    el("span", { text: `${list.length} 件・${n} 公演` }), sortButton("live", renderLives)));
  box.append(catBar("live", countBy(songTours), renderLives, "件")); // 曲で絞っているときは、その曲を演奏したライブの数
  if (rec) box.append(songBanner(rec, cats));
  else if (songMissing) box.append(el("p", { class: "sl-mine-empty", text: `「${songMissing}」を演奏したライブは、見つかりませんでした。すべてのライブを表示しています。` }));
  if (!list.length) { box.append(q ? noHit(q) : el("p", { class: "hist-loading", text: cats.size ? "選んだ区分には、合うライブがありません。区分を「すべての区分」にすると、ほかの区分のライブが出ます。" : "その曲を演奏したライブは、まだ載っていません。" })); return; }
  const years = new Map();
  for (const t of (isAsc("live") ? list : [...list].reverse())) (years.get(t.y) || years.set(t.y, []).get(t.y)).push(t);
  if (years.size > 1) {
    // 年が増えても使いやすいように、ボタンを並べず、メニューから選んで飛ぶ
    const sel = el("select", { id: "yearJump", "aria-label": "年を選ぶ（選んだ年へ移動）" }, el("option", { value: "", text: "年を選ぶ" }), ...[...years.keys()].map((y) => el("option", { value: y, text: `${y}年` })));
    // 選んだ年へ飛ぶ。表示を「年を選ぶ」に戻すのは、メニューから離れたとき（矢印キーで1年ずつ進めても、順に飛べるように）
    sel.addEventListener("change", () => { const sec = document.getElementById(`y${sel.value}`); if (sec) scrollToEl(sec); });
    sel.addEventListener("blur", () => { sel.value = ""; });
    sel.addEventListener("pointerdown", () => { sel.value = ""; }); // マウスやタップで開くときも戻す（同じ年をもう一度選んでも飛べるように）
    box.querySelector(".sl-cats").append(sel); // 区分のメニューの右に並べる（見た目は同じ丸い枠）
  }
  // 曲で絞り込んだばかりのときは、いちばん上のツアーと、その中の最初の公演を開いて、色をつけた曲がすぐ見えるようにする
  let opened = openIds;
  if (!opened && rec && !q) {
    const t0 = years.values().next().value[0];
    const l0 = t0.lives.find((l) => played.has(l));
    opened = new Set([t0.id, l0 && liveId(l0)]);
  }
  let first = true;
  for (const [y, items] of years) {
    box.append(el("section", { class: "sl-year", id: `y${y}`, "aria-labelledby": `yh${y}` },
      el("h2", { id: `yh${y}`, class: "hist-year-head" }, el("span", { text: String(y) }), " ", el("small", { text: `${items.length} 件` })),
      ...items.map((t) => { const c = tourCard(t, opened ? opened.has(t.id) : first && !q && !rec, opened, played); first = false; return c; })));
  }
}

// ライブで未演奏の曲：楽曲一覧にあって、このページのどの公演のセトリにも出てこない曲（発売の古い順）
const playedKeys = () => new Set([...songs.values()].map((r) => catalogKey(r.title)));
const UNPLAYED_NOTE = "楽曲一覧（アルバム・シングル・配信の曲）のうち、このページに載っている公演のセトリに一度も出てこない曲です。フェスやイベントなど、載せていないライブで演奏したことがある曲も入っています。";
function unplayedList() {
  const played = playedKeys();
  return catalog.filter((c) => !played.has(c.k));
}
// 年ごとの曲の並び（「ライブ未演奏」のタブで共通）
function unplayedYears(list) {
  const years = new Map();
  for (const c of list) (years.get(c.y) || years.set(c.y, []).get(c.y)).push(c);
  return [...years].map(([y, cs]) => el("div", { class: "sl-unplayed-year" },
    el("span", { class: "sl-unplayed-y", text: y || "" }),
    el("ul", { class: "sl-unplayed-list" }, ...cs.map((c) => el("li", {}, c.title, c.work && c.work !== c.title ? el("small", { text: `（${c.work}）` }) : null)))));
}
function renderUnplayed() {
  const panel = $("#unplayedBody"), tab = $("#tabUnplayed");
  if (!catalog.length) { tab.hidden = true; return; }
  const list = unplayedList();
  // 「ライブ未演奏」のタブ
  panel.replaceChildren(
    el("p", { class: "sl-unplayed-head" }, el("b", { text: `${list.length} 曲` }), `（全 ${catalog.length} 曲のうち）・発売の古い順`),
    el("p", { class: "sl-song-sub", text: UNPLAYED_NOTE }),
    ...unplayedYears(list));
  tab.hidden = false;
  const d = $("#slGuide");
  if (d && !d.dataset.unplayed) { d.dataset.unplayed = "1"; d.append("「ライブ未演奏」では、ライブでまだ演奏していない曲を見られます。"); }
}

/* ---------- 参加公演：行ったライブのライブ名と、印をつけた公演日だけ ---------- */

function renderMine() {
  const box = $("#mine");
  // 作り直しても、開いていたものは開いたままにする
  const openTours = new Set([...box.querySelectorAll("details.sl-mine-item[open]")].map((d) => d.dataset.tour));
  const openShows = new Set([...box.querySelectorAll("details.sl-show[open]")].map((d) => d.dataset.ak));
  const list = [];
  for (const t of (isAsc("mine") ? tours : [...tours].reverse())) {
    const ls = t.lives.filter((l) => attended.has(l.ak));
    if (ls.length && hitTour(t, queries.mine)) list.push({ t, ls });
  }
  const n = list.reduce((s, x) => s + x.ls.length, 0);
  box.replaceChildren(el("p", { class: "hist-view sl-view" }, el("b", { text: "参加公演" }), el("span", { text: n ? `${list.length} 件・${n} 公演` : "" }), n ? sortButton("mine", renderMine) : null));
  if (!n && queries.mine) { box.append(noHit(queries.mine)); return; }
  if (!n) {
    box.append(el("p", { class: "sl-mine-empty", text: "まだ、行ったライブはありません。「ライブ」で、公演の足あとのアイコンを押すと、ここに並びます。" }));
    return;
  }
  // ライブ名を押す → 行った公演日が出る → 公演日を押す → セトリが開く
  for (const { t, ls } of list) {
    const one = ls.length === 1;
    const card = el("details", { class: "sl-live sl-mine-item", "data-tour": t.id, open: openTours.has(t.id) || null },
      el("summary", {},
        el("h2", { class: "sl-live-name", text: t.name }),
        el("p", { class: "sl-live-venue" }, one ? [dateLabel(ls[0]), ls[0].venue].filter(Boolean).join(" ／ ") : `${ls.length}公演に参加`)),
      el("div", { class: "sl-shows" }, ...ls.map((l) => {
        const row = showRow(l, openShows.has(l.ak));
        row.removeAttribute("id"); // 「ライブ」のタブと id が重ならないように
        row.dataset.ak = l.ak;
        return row;
      })));
    box.append(card);
  }
}
attended.onChange(() => { if (lives.length) renderMine(); });

/* ---------- ランキング：よく演奏された曲 ---------- */

// 割合の書き方：10% 以上は整数、それより小さいときは小数1けた（1公演でも 0% にならないように）
const pctLabel = (n, total) => { const p = (n / total) * 100; return `${p >= 10 ? Math.round(p) : p.toFixed(1)}%`; };
const RANK_TOP = 30; // はじめに出す曲の数（「すべて見る」で全曲）

// 選んだ区分・年代の公演（セトリがあるものだけ）で、曲ごとに何公演で演奏したかを数える
function rankRows(cats = catState.ranking) {
  // 楽曲一覧（data/songs.csv）があるときは、そこに載っている曲（発表された曲）だけを数える
  const released = catalog.length ? new Set(catalog.map((c) => c.k)) : null;
  const target = lives.filter((l) => hasSongs(l) && (!cats.size || cats.has(l.cat)));
  const m = new Map();
  for (const l of target) {
    // 【kZm】【Awich】のような、ほかの出演者の見出しの下の曲は数えない（野田洋次郎のソロの曲も入れない。【アンコール1】などの下は数える）
    for (const k of new Set(songsOf(l).filter((s) => !s.part || /^アンコール/.test(s.part)).map((s) => songKey(s.title)))) {
      if (released && !released.has(catalogKey(songs.get(k).title))) continue; // 楽曲一覧にない曲（未発表の曲・カバーなど）は入れない
      const r = m.get(k) || m.set(k, { k, title: songs.get(k).title, n: 0, last: l }).get(k);
      r.n++; r.last = l;
    }
  }
  const rows = [...m.values()].sort((a, b) => b.n - a.n || a.title.localeCompare(b.title, "ja"));
  // 同じ回数は同じ順位（1, 2, 2, 4 …）
  rows.forEach((r, i) => { r.rank = i && rows[i - 1].n === r.n ? rows[i - 1].rank : i + 1; });
  return { rows, total: target.length };
}


function renderRanking() {
  const box = $("#ranking");
  const { rows, total } = rankRows();
  const catCounts = countBy(lives.filter(hasSongs));
  const cats = catState.ranking;
  const max = rows[0]?.n || 1;
  // 少ない順：回数の少ない曲から（同じ回数は曲名順）。0回の曲は、もともと数に入らないので出ません
  const asc = isAsc("ranking");
  const ordered = asc ? [...rows].sort((a, b) => a.n - b.n || a.title.localeCompare(b.title, "ja")) : rows;
  const cut = ordered[Math.min(RANK_TOP, ordered.length) - 1];
  // はじめは30曲まで（多い順は、30曲目と同じ回数の曲もあわせて出す。少ない順は、1回の曲がとても多いので、ちょうど30曲で区切る）
  const q = queries.ranking;
  // 検索の言葉があるときは、30曲の区切りをやめて、合う曲をすべて出す
  const shown = q ? ordered.filter((r) => looseMatchAll(r.title, q)) : rankAll || !cut ? ordered : asc ? ordered.slice(0, RANK_TOP) : ordered.filter((r) => r.n >= cut.n);
  const ol = el("ol", { class: "sl-rank" });
  for (const r of shown) {
    const bar = el("span", { class: "sl-rank-bar", "aria-hidden": "true" }, el("span", {}));
    bar.firstChild.style.width = `${(r.n / max) * 100}%`; // 回数の長さ（いちばん多い曲を 100%）
    ol.append(el("li", { class: "sl-rank-row" + (r.rank <= 3 ? " top" : "") + (r.k === rankSong ? " last" : "") },
      el("span", { class: "sl-rank-no", text: String(r.rank) }),
      el("span", { class: "sl-rank-main" },
        el("button", { type: "button", class: "sl-song", "data-song": r.k, title: `「${r.title}」を演奏したライブだけを見る` }, r.title),
        bar),
      el("span", { class: "sl-rank-n" }, el("b", { text: String(r.n) }), " 公演", el("small", { text: pctLabel(r.n, total) }))));
  }
  box.replaceChildren(
    el("p", { class: "hist-view sl-view" }, el("b", { text: cats.size ? [...cats].join("・") : "すべて" }),
      el("span", { text: total ? `セトリがある ${total} 公演・${rows.length} 曲` : "セトリがある公演は、まだありません" }), rows.length ? sortButton("ranking", renderRanking) : null),
    catBar("ranking", catCounts, renderRanking, "公演"),
    el("p", { class: "sl-song-sub", text: "数字は、その曲を演奏した公演の数です（1つの公演で2回やっても1回。1回も演奏していない曲は入れていません" + (catalog.length ? "。楽曲一覧に載っていない曲（未発表の曲・ほかの人の曲のカバー・映画の劇伴）も入れていません" : "") + "）。% は、セトリがある公演のうち何割で演奏したか。曲名を押すと、その曲を演奏したライブだけが「ライブ」に並びます。" }),
    ...(q && !shown.length ? [noHit(q)] : []),
    ol);
  if (!q && shown.length < rows.length) {
    const more = el("button", { type: "button", class: "sl-clear sl-rank-more", text: `すべて見る（${rows.length} 曲）` });
    more.addEventListener("click", () => { const k = shown.length; rankAll = true; renderRanking(); $(`#ranking .sl-rank-row:nth-child(${k + 1}) .sl-song`)?.focus(); });
    box.append(more);
  }
}

/* ---------- 切り替えと URL ---------- */

// push：利用者が曲を選んだ・タブを押したときは履歴に積む（ブラウザの「戻る」で前の状態へ）。それ以外は書き換えるだけ
function saveUrl(push = false) {
  const p = new URLSearchParams();
  if (song && songs.has(song)) p.set("song", songs.get(song).title);
  if (view === "live" && queries.live.trim()) p.set("q", queries.live.trim()); // 「ライブ」の検索の言葉（再読み込み・共有でも残る）
  const q = p.toString() ? `?${p}` : "";
  const url = location.pathname + q + `#${view}`;
  const state = { liveCats: [...catState.live] }; // 「戻る」で「ライブ」で選んだ区分も戻せるように
  if (push && url !== location.pathname + location.search + location.hash) history.pushState(state, "", url);
  else history.replaceState(state, "", url);
}

const searchBox = $("#viewSearch");
function rerenderView() {
  ({ mine: renderMine, live: renderLives, ranking: renderRanking, unplayed: renderUnplayed })[view]();
}
let searchTimer = 0;
searchBox.addEventListener("input", () => {
  queries[view] = searchBox.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { if (lives.length) { rerenderView(); if (view === "live") saveUrl(); } }, 150);
});
searchBox.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) searchBox.blur(); }); // 日本語の変換を確定する Enter では閉じない

function setView(v, { scroll = false, push = false } = {}) {
  v = VIEW_ALIAS[v] || v;
  view = VIEWS.includes(v) && !(v === "unplayed" && !catalog.length) ? v : "live";
  searchBox.value = queries[view];
  searchBox.placeholder = PLACEHOLDERS[view];
  searchBox.closest(".sl-search").hidden = view === "unplayed"; // ライブ未演奏は曲数が少ないので、検索窓は出さない
  for (const b of document.querySelectorAll(".sl-tab")) b.setAttribute("aria-selected", String(b.dataset.view === view));
  $("#mine").hidden = view !== "mine";
  $("#tabs").dataset.view = view;
  $("#lives").hidden = view !== "live";
  $("#ranking").hidden = view !== "ranking";
  $("#unplayedView").hidden = view !== "unplayed";
  saveUrl(push);
  // 選んだタブが見えるように、タブの帯を左右に動かす（縦には動かさない）
  const tabs = $("#tabs"), cur = $(`.sl-tab[data-view="${view}"]`);
  tabs.scrollTo({ left: Math.max(0, cur.offsetLeft - (tabs.clientWidth - cur.offsetWidth) / 2), behavior: scroll ? "smooth" : "auto" });
  // ランキングに戻ったときは、前に押した曲の位置へ
  const last = view === "ranking" && rankSong && $("#ranking .sl-rank-row.last");
  if (last) { scrollTo({ top: last.getBoundingClientRect().top + scrollY - headerH() - stickyH() - 16 }); return; }
  if (scroll) {
    const top = $(".hist-tabs-bar").getBoundingClientRect().top + scrollY - headerH();
    if (scrollY > top) scrollTo({ top });
  }
}

function setSong(key, { scroll = true, push = true } = {}) {
  song = key && songs.has(key) ? key : "";
  songMissing = "";
  renderLives();
  renderMine(); // 参加公演のセトリの色も、いまの曲に合わせる
  if (view !== "live") setView("live", { push }); else saveUrl(push);
  // 作り直した画面でも、キーボードの位置が迷子にならないように、案内（なければ見出しの行）へ移す
  const f = $("#lives .sl-song-head") || $("#lives .sl-view");
  if (f) { f.tabIndex = -1; f.focus({ preventScroll: true }); }
  if (scroll) scrollTo({ top: $("#lives").getBoundingClientRect().top + scrollY - headerH() - stickyH() - 8 });
}

const headerH = () => $("#header").getBoundingClientRect().height;
// 上に残っているタブの帯（タブと検索窓）の高さ。背の低い画面では上に残さないので 0（style.css の max-height: 500px）
const stickyH = () => { const b = $(".hist-tabs-bar"); return getComputedStyle(b).position === "sticky" ? b.offsetHeight : 0; };
const scrollToEl = (d) => scrollTo({ top: d.getBoundingClientRect().top + scrollY - headerH() - stickyH() - 8 });

$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-view]");
  if (b) setView(b.dataset.view, { scroll: true, push: true });
});
// 左右の矢印キーで切り替え（何度も押すので、履歴には積まず、URL を書き換えるだけ）
$("#tabs").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const vs = [...document.querySelectorAll(".sl-tab:not([hidden])")].map((b) => b.dataset.view);
  setView(vs[(vs.indexOf(view) + (e.key === "ArrowRight" ? 1 : vs.length - 1)) % vs.length]);
  document.querySelector(`.sl-tab[data-view="${view}"]`).focus();
});
document.addEventListener("click", (e) => {
  // 曲名を押す → 「ライブ」で、その曲を演奏したライブだけにする（もう一度押すか「絞り込みを解除」で戻る）
  const b = e.target.closest("[data-song]");
  if (b && b.closest("#ranking")) {
    // ランキングで押した曲を覚えて、印をつける
    rankSong = b.dataset.song;
    if (catState.ranking.size) catState.live = new Set(catState.ranking); // 区分を絞っていたら、「ライブ」でも同じ区分で見られる
    for (const r of document.querySelectorAll("#ranking .sl-rank-row")) r.classList.toggle("last", r.contains(b));
  }
  if (b) { setSong(b.dataset.song === song && view === "live" ? "" : b.dataset.song, { scroll: b.classList.contains("sl-song") }); return; }
});
function findSong(text) {
  const k = songKey(text);
  if (!k) return "";
  if (songs.has(k)) return k;
  // 楽曲一覧にそのままある曲で、まだ演奏していないときは、名前の一部が似た別の曲を出さない
  if (catalog.some((c) => c.k === catalogKey(text)) && ![...songs.values()].some((r) => catalogKey(r.title) === catalogKey(text))) return null;
  // 名前の一部のときは、前方一致 → 部分一致の順で、短い曲名（カバー「〜 [歌手名]」は後回し）を選ぶ
  const keys = [...songs.keys()].sort((a, b) => /\[/.test(songs.get(a).title) - /\[/.test(songs.get(b).title) || a.length - b.length);
  return keys.find((x) => x.startsWith(k)) || keys.find((x) => x.includes(k)) || null;
}
// いちばん上へ戻るボタン
const toTop = $("#toTop");
addEventListener("scroll", () => { toTop.hidden = scrollY < 900; }, { passive: true });
toTop.addEventListener("click", () => scrollTo({ top: 0, behavior: "smooth" }));

// 「行った」ボタン
setupAttendClicks();
// メニュー（ほかのページと同じ動き。ui.js）
setupMenu();
watchScrollFade($("#tabs"));
watchStuck($(".hist-tabs-bar")); // 上に貼りついたときだけ、帯に暗い地を敷く
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
    const [iT, iW, iY, iK, iL, iA] = [ci("曲名"), ci("初めて出た作品"), ci("年"), ci("種類"), ci("歌詞URL"), ci("名義")];
    if (iT < 0) return;
    // 「〈宿題発表-skit-〉」のような skit（曲と曲のあいだの短い寸劇）は、ライブでやる曲ではないので入れない
    // サウンドトラックの曲のうち、歌詞のない劇伴（映画の場面の音楽）と、映画用に短くした「(movie edit)」の版も入れない
    // （歌のある「夢灯籠」「スパークル」などは入れる）
    const isScore = (r) => iK >= 0 && (r[iK] || "").trim() === "サウンドトラック"
      && (iL < 0 || !(r[iL] || "").trim() || /\(movie edit\)\s*$/i.test(r[iT]));
    // 「名義」が RADWIMPS 以外（illion など、野田洋次郎のソロの曲）は、RADWIMPS のライブの曲ではないので入れない
    const isOther = (r) => iA >= 0 && !["", "radwimps"].includes((r[iA] || "").normalize("NFKC").trim().toLowerCase());
    catalog = rows.slice(1).filter((r) => (r[iT] || "").trim() && !/skit/i.test(r[iT]) && !isScore(r) && !isOther(r)).map((r) => {
      const title = r[iT].trim();
      return { title, work: (r[iW] || "").trim(), y: +(r[iY] || 0) || 0, k: catalogKey(title) };
    }).sort((a, b) => a.y - b.y);
    renderUnplayed();
    renderRanking(); // 楽曲一覧を読んだら、ランキングを発表された曲だけで数え直す
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
    assignKeys(lives);
    groupTours();
    indexSongs();
    if (lives.length) $("#span").textContent = `${lives[0].y} — ${lives[lives.length - 1].y}`;
    renderRanking();
    const q = new URLSearchParams(location.search).get("song");
    // ?q= で、「ライブ」を検索した状態で開ける（「RADWIMPSの歩み」の検索から来たときなど）
    const q0 = new URLSearchParams(location.search).get("q");
    if (q0) queries.live = q0.slice(0, 100);
    song = q ? findSong(q) || "" : "";
    songMissing = q && !song ? q : "";
    renderLives();
    renderMine();
    loadCatalog();
    loadHistory(); // 歩みの年表などは、セトリを出したあとで読んで足す
    setView(song && !location.hash ? "live" : location.hash.slice(1));
  } catch (e) {
    console.error(e);
    $("#loading").textContent = "セットリストを読み込めませんでした。時間をおいて、もう一度開いてください。";
  }
})();
// ブラウザの「戻る」「進む」：URL の ?song= と #タブ から、絞り込みとタブを戻す
addEventListener("popstate", (e) => {
  if (!lives.length) return;
  const q = new URLSearchParams(location.search).get("song");
  const k = q ? findSong(q) || "" : "";
  const cats = e.state?.liveCats;
  const catsChanged = Array.isArray(cats) && (cats.length !== catState.live.size || cats.some((c) => !catState.live.has(c)));
  if (catsChanged) catState.live = new Set(cats.slice(0, 1)); // 区分は1つだけ選ぶ（以前の履歴に複数あっても、最初の1つ）
  if (k !== song || catsChanged) {
    song = k; songMissing = q && !k ? q : "";
    renderLives(); renderMine();
    const f = $("#lives .sl-song-head") || $("#lives .sl-view");
    if (f && view === "live") { f.tabIndex = -1; f.focus({ preventScroll: true }); }
  }
  // #ranking などのタブの印だけを見る（#lives のようなページ内リンクでは、タブを変えない）。ハッシュを手で書き換えたときも、ここに来る
  const h = VIEW_ALIAS[location.hash.slice(1)] || location.hash.slice(1) || "live";
  if (VIEWS.includes(h) && h !== view) setView(h);
});
