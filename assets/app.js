// assets/app.js
// 画面の動きを担当するプログラムです。
//   1. data/articles.csv と data/releases.csv を読み込む
//   2. メニュー（カテゴリ・あとで読む・記事を追加・マイページ・管理画面）を作り、ページを切り替える
//   3. 検索・絞り込み・並び替えをして一覧を表示する
//   4. お気に入り（★）・あとで読む・既読を、このブラウザに保存する（バックアップの書き出し・読み込みも）
// 記事を増やしたり直したりするときは、このファイルではなく data/articles.csv を編集します。

import config from "./config.js";
import { parseArticles, parseReleases, KIND_ORDER, MEMBERS, MEMBER_ORDER, LANG_NAME, CATEGORIES, youtubeId } from "./data.js";

/* ---------- 共通の道具 ---------- */

const STORE_MARKS = "radwimps-interview-index:marks"; // お気に入り・あとで読む・既読の保存場所の名前
const STORE_UI = "radwimps-interview-index:ui";       // 表示の状態（タブ・並び順・絞り込み）の保存場所の名前
const STORE_ADMIN = "radwimps-interview-index:admin"; // 管理者モード（この端末だけの設定）

const $ = (s) => document.querySelector(s);
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// 画面の部品を作る小さな関数：h("p", { class: "note", text: "本文" })
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}

function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 保存できない環境では何もしない */ } }

// 検索用に文字をそろえる：全角半角・大文字小文字・ひらがなとカタカナの違いをなくし、記号や空白を取り除く
const STRIP = /[\s　・、，,。．.／/「」『』【】〔〕［］[\]（）()<>＜＞〈〉《》\-‐–—―_~〜～!！?？:：;；'"“”‘’`*＊#＃|｜×✕+＋&＆]/g;
function norm(s) {
  return String(s || "").normalize("NFKC").toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(STRIP, "");
}
const memberLabel = (key) => MEMBERS[key].filterLabel || MEMBERS[key].name;
// 一覧の左の列に出す日付（年は見出しにあるので、月と日だけ）：「10.09」「10月」、年までしかわからないときは「—」
function railDate(d) {
  const [, m, day] = (d || "").split("-");
  if (day) return m + "." + day;
  if (m) return +m + "月";
  return "";
}
function fullDate(d) {
  const [y, m, day] = (d || "").split("-");
  if (!y) return "日付不明";
  return y + "年" + (m ? +m + "月" : "") + (day ? +day + "日" : "");
}

/* ---------- 状態 ---------- */

const savedUI = load(STORE_UI) || {};
const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 80) : []);

const S = {
  items: [],      // 表示する記事（状態が「公開」のもの）
  parsed: null,   // 記事データを読んだ結果（管理画面で、非表示の行や書式の問題を数えるため）
  releases: {},   // 年ごとの主なリリース
  cats: [],       // メニューに出すカテゴリ（CATEGORIES と、データにだけある新しいカテゴリ）
  view: null,     // いま見ているページ（URL の末尾の #○○ から決まる）
  q: "",
  tab: ["all", "bm", "unread"].includes(savedUI.tab) ? savedUI.tab : "all",
  sort: savedUI.sort === "asc" ? "asc" : "desc",
  f: {
    w: new Set(arr(savedUI.w).filter((x) => MEMBERS[x])),
    k: new Set(arr(savedUI.k)),
    lang: ["ja", "intl"].includes(savedUI.lang) ? savedUI.lang : "",
    y: new Set(arr(savedUI.y)),
    tag: new Set(arr(savedUI.tag))
  },
  marks: cleanMarks(load(STORE_MARKS)),
  admin: load(STORE_ADMIN) === 1,
  loaded: false   // 記事データを読み込み終わったか
};

function cleanMarks(m) {
  const out = { bm: {}, lt: {}, rd: {} }; // bm：お気に入り　lt：あとで読む　rd：既読
  for (const key of ["bm", "lt", "rd"]) {
    const src = m && m[key];
    if (src && typeof src === "object") for (const id of Object.keys(src)) if (src[id] && id.length < 160) out[key][id] = 1;
  }
  return out;
}
const saveMarks = () => save(STORE_MARKS, S.marks);
const saveUI = () => save(STORE_UI, { tab: S.tab, sort: S.sort, w: [...S.f.w], k: [...S.f.k], lang: S.f.lang, y: [...S.f.y], tag: [...S.f.tag] });

/* ---------- ページ（URL の末尾の #○○） ---------- */
// #articles：すべての記事　#c-○○：カテゴリ　#videos：動画　#later：あとで読む
// #mypage：マイページ　#admin：管理画面（#admin-add：管理画面で記事を追加）　#add：記事の追加をお願いする

function catBySlug(slug) { return S.cats.find((c) => c.slug === slug); }

function viewFromHash() {
  const key = location.hash.replace(/^#/, "");
  if (key === "videos") return { page: "list", cat: "video", key, title: "動画" };
  if (key === "later") return { page: "list", cat: "later", key, title: "あとで読む", desc: "あとで読む印を付けた記事と動画です" };
  if (key.startsWith("c-")) {
    const c = catBySlug(key.slice(2));
    if (c) return { page: "list", cat: "article", group: c.name, key, title: c.name, desc: c.desc };
  }
  if (key === "mypage") return { page: "mypage", key, title: "マイページ", desc: "この端末に保存している記録です" };
  if (key === "admin") return { page: "admin", key, title: "管理画面" };
  if (key === "admin-add") return { page: "admin", key, title: "管理画面", openNew: true }; // 管理者の「記事を追加」
  if (key === "add") return { page: "add", key, title: "記事の追加をお願いする" };
  return { page: "list", cat: "article", key: "articles", title: "すべての記事" };
}

// データにだけある新しいカテゴリにも、メニュー用の名前（#c-x1 など）を付ける
function buildCats() {
  const known = new Set(CATEGORIES.map((c) => c.name));
  const extra = [];
  for (const it of S.items) for (const c of it.categories) if (!known.has(c) && !extra.includes(c)) extra.push(c);
  S.cats = [...CATEGORIES, ...extra.map((name, i) => ({ name, slug: "x" + (i + 1), desc: "" }))];
}

/* ---------- データの読み込み ---------- */

function prep(it, i) {
  it._i = i;
  it._y = it.date ? it.date.slice(0, 4) : "----";
  it._k = it.date ? (it.date + "-00-00").slice(0, 10) : "0000-00-00";
  const names = it.members.map((k) => [MEMBERS[k].name, MEMBERS[k].romaji, MEMBERS[k].kana].join(" ")).join(" ");
  it._h = norm(["radwimps らっどうぃんぷす", it.title, it.media, names, it.guests.join(" "), it.tags.join(" "), it.categories.join(" "), it.note, it.kind, it.date].join(" "));
  return it;
}

// 記事データ（CSV の文字列）を読んで、表示に使う形にする
function ingest(text) {
  const parsed = parseArticles(text);
  if (parsed.errors.length) console.warn("記事データに書式の問題がある行があります（その行は表示していません）", parsed.errors);
  S.parsed = parsed;
  S.items = parsed.items.filter((it) => it.state === "公開").map(prep);
  buildCats();
  S.view = viewFromHash();
}

async function loadData() {
  try {
    const [aRes, rRes] = await Promise.all([
      fetch("data/articles.csv", { cache: "no-cache" }),
      fetch("data/releases.csv", { cache: "no-cache" }).catch(() => null)
    ]);
    if (!aRes.ok) throw new Error("articles.csv: HTTP " + aRes.status);
    ingest(await aRes.text());
    if (rRes && rRes.ok) S.releases = parseReleases(await rRes.text()).byYear;
    const lm = aRes.headers.get("Last-Modified");
    const dt = lm ? new Date(lm) : null;
    if (dt && !isNaN(dt)) $("#updated").textContent = `最終更新：${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日`;
    S.loaded = true;
    $("#loading").hidden = true;
    render();
  } catch (e) {
    console.error(e);
    $("#loading").textContent = "記事データを読み込めませんでした。時間をおいて、ページを開き直してください。";
  }
}

/* ---------- 絞り込み ---------- */

const terms = () => S.q.split(/[\s　]+/).map(norm).filter(Boolean);
const isIntl = (it) => it.lang !== "ja";
// いま見ているページの記事
function inView() {
  const v = S.view;
  if (v.cat === "later") return S.items.filter((it) => S.marks.lt[it.id]);
  return S.items.filter((it) => it.cat === v.cat && (!v.group || it.categories.includes(v.group)));
}
const kindApplies = () => S.view.cat !== "video"; // 「種類」の絞り込みは、動画のページでは使わない

function passes(it, ts, skip) {
  if (S.tab === "bm" && !S.marks.bm[it.id]) return false;
  if (S.tab === "unread" && S.marks.rd[it.id]) return false;
  for (const t of ts) if (!it._h.includes(t)) return false;
  const f = S.f;
  if (skip !== "w" && f.w.size && !it.members.some((x) => f.w.has(x))) return false;
  if (skip !== "k" && kindApplies() && f.k.size && !f.k.has(it.kind)) return false;
  if (skip !== "lang" && f.lang === "ja" && isIntl(it)) return false;
  if (skip !== "lang" && f.lang === "intl" && !isIntl(it)) return false;
  if (skip !== "y" && f.y.size && !f.y.has(it._y)) return false;
  if (skip !== "tag" && f.tag.size && !it.tags.some((x) => f.tag.has(x))) return false;
  return true;
}
function sortItems(list) {
  const dir = S.sort === "asc" ? 1 : -1;
  return list.slice().sort((a, b) => (a._k < b._k ? -1 : a._k > b._k ? 1 : 0) * dir || a._i - b._i);
}
const filterCount = () => S.f.w.size + (kindApplies() ? S.f.k.size : 0) + (S.f.lang ? 1 : 0) + S.f.y.size + S.f.tag.size;

/* ---------- 描画 ---------- */

const STAR = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.3l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6-4.4-4.2 6-.8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const CLOCK = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.6V12l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHECK = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8.3 12.3l2.5 2.5 4.9-5.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function render() {
  if (!S.view) S.view = viewFromHash();
  renderMenu();
  renderHead();
  const page = S.view.page;
  $("#listView").hidden = page !== "list";
  for (const p of ["mypage", "admin", "add"]) $("#page-" + p).hidden = page !== p;
  if (page === "list") {
    renderStats();
    renderTabs();
    renderFilters();
    renderActive();
    renderList();
    renderCross();
  } else if (page === "mypage") renderMypage();
  else if (page === "admin") renderAdmin();
  else if (page === "add") renderAdd();
  $("#qclear").hidden = !S.q;
}

// ページの見出し（いま見ているページの名前と件数、短い説明）
function renderHead() {
  const v = S.view;
  $("#top").textContent = v.title;
  const n = v.page === "list" && S.loaded ? inView().length : null;
  $("#vcount").textContent = n === null ? "" : `${n} 件`;
  $("#vdesc").textContent = v.desc || "";
  $("#vdesc").hidden = !v.desc;
  $("#q").placeholder = v.cat === "video" ? "動画の題名・人名など" : "題名・人名・作品名など";
  document.title = v.key === "articles" ? "RADWIMPS Archive" : `${v.title}｜RADWIMPS Archive`;
}

// メニューの中身：カテゴリ（件数つき）、動画、あとで読む、記事を追加、管理画面（管理者だけ）、マイページ
function renderMenu() {
  const box = $("#menuIn");
  const cur = S.view.key;
  const articles = S.items.filter((it) => it.cat === "article");
  const count = (name) => articles.filter((it) => it.categories.includes(name)).length;
  const item = (href, label, n, key, extraClass) => h("a", { class: "mi" + (extraClass ? " " + extraClass : ""), href, "aria-current": key === cur ? "page" : null },
    h("span", { class: "ml", text: label }), n === null || n === undefined ? null : h("span", { class: "mn", text: n }));
  const cats = S.cats.map((c) => [c, count(c.name)]).filter(([, n]) => n > 0);
  box.replaceChildren(
    h("p", { class: "mh", text: "記事のカテゴリ" }),
    h("div", { class: "mgroup" },
      item("#articles", "すべての記事", S.loaded ? articles.length : null, "articles"),
      ...cats.map(([c, n]) => item("#c-" + c.slug, c.name, n, "c-" + c.slug))),
    h("div", { class: "mgroup msep" }, item("#videos", "動画", S.loaded ? S.items.filter((it) => it.cat === "video").length : null, "videos")),
    h("div", { class: "mgroup mtools" },
      item("#later", "あとで読む", Object.keys(S.marks.lt).filter((id) => S.items.some((it) => it.id === id)).length, "later", "ic-later"),
      S.admin ? item("#admin-add", "記事を追加", null, "admin-add", "ic-add") : item("#add", "記事を追加", null, "add", "ic-add"),
      S.admin ? item("#admin", "管理画面", null, "admin", "ic-admin") : null,
      item("#mypage", "マイページ", null, "mypage", "ic-my"))
  );
}

function renderStats() {
  let here = 0, hereBm = 0, hereRd = 0;
  for (const it of inView()) { here++; if (S.marks.bm[it.id]) hereBm++; if (S.marks.rd[it.id]) hereRd++; }
  $("#tn-all").textContent = here;       // タブの数字は、いま表示しているページの分
  $("#tn-bm").textContent = hereBm;
  $("#tn-ur").textContent = here - hereRd;
}

// 一覧の最後に、もう一方のページへのリンクを出す
function renderCross() {
  const v = S.view;
  let link = null;
  if (v.cat === "article" && !v.group) {
    const n = S.items.filter((it) => it.cat === "video").length;
    if (n) link = h("a", { href: "#videos", text: `動画も見る（${n} 件）` });
  } else if (v.cat === "article" && v.group) {
    link = h("a", { href: "#articles", text: "すべての記事を見る" });
  } else if (v.cat === "video") {
    link = h("a", { href: "#articles", text: "記事を見る" });
  }
  $("#cross").replaceChildren(...(link ? [link] : []));
}

function renderTabs() {
  document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === S.tab)));
  const n = filterCount();
  $("#fbadge").hidden = !n;
  $("#fbadge").textContent = n;
}

// 絞り込みの選択肢（n は件数。並び順のように件数を出さないものは null）
function chip(g, v, label, on, n) {
  return h("button", {
    type: "button", class: "chip", "aria-pressed": String(on), "data-g": g, "data-v": v, "data-key": g + ":" + v,
    disabled: !on && n === 0
  }, label, n === null ? null : h("span", { class: "n", text: n }));
}
function group(title, chips) {
  return h("div", { class: "fgroup" }, h("h3", { text: title }), h("div", { class: "chips" }, ...chips));
}

function renderFilters() {
  const box = $("#fgroups");
  const active = document.activeElement;
  const focusKey = active && box.contains(active) ? active.dataset.key : null;
  const ts = terms();
  const all = inView();
  const count = (g, pred) => { let n = 0; for (const it of all) if (passes(it, ts, g) && pred(it)) n++; return n; };

  const kinds = !kindApplies() ? [] : [...KIND_ORDER.filter((k) => all.some((it) => it.kind === k)), ...new Set(all.map((it) => it.kind).filter((k) => !KIND_ORDER.includes(k)))];
  const years = [...new Set(all.map((it) => it._y))].sort().reverse();
  const tagCount = new Map();
  for (const it of all) for (const t of it.tags) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  const topTags = [...tagCount.entries()]
    .filter(([t, n]) => n >= 2 || S.f.tag.has(t))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))
    .slice(0, 28).map(([t]) => t);

  box.replaceChildren(...[
    group("並び順", [["desc", "新しい順"], ["asc", "古い順"]].map(([v, l]) => chip("sort", v, l, S.sort === v, null))),
    group("メンバー", MEMBER_ORDER.map((m) => chip("w", m, memberLabel(m), S.f.w.has(m), count("w", (it) => it.members.includes(m))))),
    kinds.length ? group("種類", kinds.map((k) => chip("k", k, k, S.f.k.has(k), count("k", (it) => it.kind === k)))) : null,
    group("言語", [["ja", "日本語"], ["intl", "海外メディア"]].map(([v, l]) => chip("lang", v, l, S.f.lang === v, count("lang", (it) => (v === "ja" ? !isIntl(it) : isIntl(it)))))),
    group("年", years.map((y) => chip("y", y, y === "----" ? "日付不明" : y, S.f.y.has(y), count("y", (it) => it._y === y)))),
    topTags.length ? group("作品・トピック", topTags.map((t) => chip("tag", t, t, S.f.tag.has(t), count("tag", (it) => it.tags.includes(t))))) : null
  ].filter(Boolean));
  if (focusKey) {
    const el = [...box.querySelectorAll("[data-key]")].find((x) => x.dataset.key === focusKey);
    if (el) el.focus();
  }
}

function renderActive() {
  const box = $("#active");
  const list = [];
  if (S.q.trim()) list.push(["q", "", "「" + S.q.trim() + "」"]);
  for (const m of S.f.w) list.push(["w", m, memberLabel(m)]);
  if (kindApplies()) for (const k of S.f.k) list.push(["k", k, k]);
  if (S.f.lang) list.push(["lang", S.f.lang, S.f.lang === "ja" ? "日本語" : "海外メディア"]);
  for (const y of S.f.y) list.push(["y", y, y === "----" ? "日付不明" : y + "年"]);
  for (const t of S.f.tag) list.push(["tag", t, "#" + t]);
  if (S.sort === "asc") list.push(["sort", "asc", "古い順"]);
  box.hidden = !list.length;
  box.replaceChildren(...list.map(([g, v, l]) =>
    h("button", { type: "button", class: "achip", "data-g": g, "data-v": v, "aria-label": l + " の条件を外す" }, l, h("span", { "aria-hidden": "true", text: "×" }))));
  if (list.length > 1) box.append(h("button", { type: "button", class: "aclear", "data-g": "all", text: "すべて解除" }));
}

function whoLine(it) {
  const ms = it.members.map((k) => MEMBERS[k].name);
  if (!ms.length && !it.guests.length) return null;
  const s = !ms.length
    ? (it.kind === "ほかの人が語る" ? "話し手：" : "") + it.guests.join("・")
    : ms.join("・") + (it.guests.length ? " × " + it.guests.join("・") : "");
  return h("span", { class: "who", text: s });
}

function markButton(act, on, svg, label) {
  const b = h("button", { type: "button", class: "ib " + act, "data-act": act, "aria-pressed": String(on), "aria-label": label, title: label });
  b.innerHTML = svg;
  return b;
}

// 記事1件の表示：左の列に日付、右の列にタイトル（2行まで）と、媒体・種類・人の1行、★・あとで読む・既読のボタン
function itemRow(it) {
  const bm = !!S.marks.bm[it.id], lt = !!S.marks.lt[it.id], rd = !!S.marks.rd[it.id];
  const vid = it.cat === "video" ? youtubeId(it.url) : null;
  const li = h("li", { class: "item" + (vid ? " has-thumb" : "") + (bm ? " is-bm" : "") + (lt ? " is-lt" : "") + (rd ? " is-read" : ""), "data-id": it.id });

  const rail = railDate(it.date);
  const date = rail
    ? h("time", { class: "date", datetime: it.date, title: fullDate(it.date), text: rail })
    : h("span", { class: "date", title: fullDate(it.date) }, h("span", { "aria-hidden": "true", text: "—" }), h("span", { class: "sr", text: it.date ? "日付は年まで" : "日付不明" }));

  const body = h("div", { class: "body" });
  if (vid) { // YouTube の動画は、サムネイル（縮小画像）を付ける
    const img = h("img", { src: `https://i.ytimg.com/vi/${encodeURIComponent(vid)}/mqdefault.jpg`, alt: "", loading: "lazy", width: "320", height: "180" });
    const thumb = h("a", { class: "thumb", href: it.url, target: "_blank", rel: "noopener noreferrer", tabindex: "-1", "aria-hidden": "true" }, img);
    img.addEventListener("error", () => thumb.classList.add("noimg"));
    body.append(thumb);
  }
  // タイトルは2行まで（長いものは「…」で省略。全文は長押し・マウスを重ねると出る／記事を開けば読める）
  const link = h("a", { class: "title", href: it.url, target: "_blank", rel: "noopener noreferrer", title: it.title, text: it.title });
  // 媒体・種類・言語・人を1行に（動画は「動画」と書かない）
  const meta = h("p", { class: "meta" },
    h("span", { class: "media", text: it.media }),
    it.cat === "video" ? null : h("span", { class: "kind", text: it.kind }),
    isIntl(it) ? h("span", { class: "lang", text: (LANG_NAME[it.lang] || "日本語以外の記事").replace(/の記事$/, "") }) : null,
    whoLine(it));
  // メモとタグは、ふだんは畳んでおき、「メモ・タグ」を押すと開く（一覧の文字を減らすため）
  const tags = it.tags.length
    ? h("div", { class: "tags" }, ...it.tags.map((t) => h("button", { type: "button", class: "tag", "data-tag": t, "aria-label": t + " で絞り込む", text: "#" + t })))
    : null;
  const note = it.note ? h("p", { class: "note", text: it.note }) : null;
  const more = note || tags
    ? h("details", { class: "more" }, h("summary", { text: note && tags ? "メモ・タグ" : note ? "メモ" : "タグ" }), note, tags)
    : null;
  const foot = h("div", { class: "irow" }, ...[more, h("div", { class: "acts" },
    markButton("bm", bm, STAR, "お気に入り"),
    markButton("lt", lt, CLOCK, "あとで読む"),
    markButton("rd", rd, CHECK, "既読"))].filter(Boolean));
  body.append(link, meta, foot);

  li.append(date, body);
  return li;
}

function emptyState() {
  const box = h("div", { class: "empty" });
  const v = S.view;
  const what = v.cat === "video" ? "動画" : "記事";
  const here = inView();
  if (v.cat === "later" && !here.length) {
    box.append(h("p", { text: "あとで読む記事はまだありません。記事の日付の下にある時計のボタンを押すと、ここに集まります。" }), h("a", { class: "btn", href: "#articles", text: "すべての記事を見る" }));
  } else if (!here.length) {
    box.append(h("p", { text: `まだ${what}がありません。` }));
  } else if (S.tab === "bm" && !here.some((it) => S.marks.bm[it.id])) {
    box.append(h("p", { text: `★を付けた${what}はまだありません。${what}の日付の下にある ☆ を押すと、ここに集まります。` }));
  } else if (S.tab === "unread" && !S.q && !filterCount()) {
    box.append(h("p", { text: `すべての${what}が既読です。` }));
  } else {
    box.append(h("p", { text: "条件に合う記事がありません。" }), h("button", { type: "button", class: "btn", "data-act": "reset", text: "検索と絞り込みを解除" }));
  }
  return box;
}

function renderList() {
  const ts = terms();
  const here = inView();
  const shown = sortItems(here.filter((it) => passes(it, ts)));
  // 件数は、検索や絞り込みをしているときだけ出す（ふだんは見出しとタブの数字でわかるため）
  const narrowed = !!(ts.length || filterCount());
  $("#count").textContent = narrowed ? `${shown.length} 件が見つかりました（全 ${here.length} 件）` : "";
  $("#count").hidden = !narrowed || !S.loaded;
  $("#fDone").textContent = shown.length ? `${shown.length} 件を表示` : "条件に合う記事がありません";
  const list = $("#list"), jump = $("#yearjump");
  list.replaceChildren();
  jump.replaceChildren(h("option", { value: "", text: "年へ移動" }));
  $("#yjWrap").hidden = true;
  if (!S.loaded) { $("#count").textContent = ""; return; } // 読み込み中は「読み込んでいます…」だけを出す
  if (!shown.length) { list.append(emptyState()); return; }

  const groups = new Map();
  for (const it of shown) {
    if (!groups.has(it._y)) groups.set(it._y, []);
    groups.get(it._y).push(it);
  }
  for (const [y, items] of groups) {
    const label = y === "----" ? "日付不明" : y;
    const sec = h("section", { class: "year", id: "y-" + y, "aria-labelledby": "yh-" + y },
      h("div", { class: "yhead" }, h("h2", { id: "yh-" + y, text: label }), h("span", { class: "ycount", text: items.length + " 件" })));
    const rel = S.releases[y];
    if (rel && rel.length && S.view.cat !== "later") { // その年の主なリリース（data/releases.csv）
      sec.append(h("ul", { class: "yrel", "aria-label": "この年の主なリリース" },
        h("li", { class: "rl", "aria-hidden": "true", text: "リリース" }),
        ...rel.map((r) => h("li", null, r.label ? h("span", { class: "d", text: r.label }) : null, h("b", { text: r.name })))));
    }
    sec.append(h("ol", { class: "items" }, ...items.map(itemRow)));
    list.append(sec);
    jump.append(h("option", { value: y, text: `${label}（${items.length} 件）` }));
  }
  $("#yjWrap").hidden = groups.size < 2;
}

/* ---------- マイページ ---------- */

function liveCount(kind) { return S.items.filter((it) => S.marks[kind][it.id]).length; }

function renderMypage() {
  $("#my-bm").textContent = liveCount("bm");
  $("#my-lt").textContent = liveCount("lt");
  $("#my-rd").textContent = liveCount("rd");
  $("#adminState").hidden = !S.admin;
}

/* ---------- 管理画面 ---------- */

// GitHub のリポジトリの URL（config.js に書いたもの。なければ ○○.github.io の URL から見つける）
function repoUrl() {
  if (config.repoUrl) return config.repoUrl.replace(/\/+$/, "");
  const m = location.hostname.match(/^([a-z0-9-]+)\.github\.io$/i);
  if (!m) return "";
  const first = location.pathname.split("/").filter(Boolean)[0];
  const repo = first && !/\.html?$/i.test(first) ? first : location.hostname;
  return `https://github.com/${m[1]}/${repo}`;
}
const REPO = repoUrl();

let adminEditor = null, adminLoading = false;
function renderAdmin() {
  $("#adminOffView").hidden = S.admin;
  $("#adminOnView").hidden = !S.admin;
  if (!S.admin) return;
  // 記事の管理（assets/admin.js）は、管理画面を開いたときだけ読み込む
  const wantNew = !!S.view.openNew;
  if (wantNew) { history.replaceState(null, "", "#admin"); S.view = viewFromHash(); }
  if (adminEditor) { if (wantNew) adminEditor.openNew(); }
  else if (!adminLoading) {
    adminLoading = true;
    import("./admin.js").then((m) => {
      adminEditor = m.mountAdmin($("#adminEditor"), { repo: REPO, toast, onSaved: (text) => { ingest(text); render(); } });
      if (wantNew) adminEditor.openNew();
    }).catch(() => { $("#adminEditor").replaceChildren(h("p", { class: "msg err", text: "記事の管理を読み込めませんでした。ページを開き直してください。" })); })
      .finally(() => { adminLoading = false; });
  }
  const stats = $("#admStats"), issuesBox = $("#admIssues"), links = $("#admLinks");
  if (!S.parsed) { stats.replaceChildren(h("li", { text: "記事データを読み込んでいます…" })); return; }
  const all = S.parsed.items;
  const n = (state) => all.filter((it) => it.state === state).length;
  const pub = S.items.length, vids = S.items.filter((it) => it.cat === "video").length;
  stats.replaceChildren(
    h("li", null, h("span", { text: "公開" }), h("b", { text: `${pub} 件` }), h("small", { text: `記事 ${pub - vids}・動画 ${vids}` })),
    h("li", null, h("span", { text: "非表示" }), h("b", { text: `${n("非表示")} 件` })),
    h("li", null, h("span", { text: "リンク切れ" }), h("b", { text: `${n("リンク切れ")} 件` })),
    h("li", null, h("span", { text: "あとで読む（この端末）" }), h("b", { text: `${liveCount("lt")} 件` })));
  const { errors, warnings } = S.parsed;
  const lines = (list, label, cls) => list.slice(0, 30).map((e) => h("li", { class: cls, text: `${label}（${e.line} 行目）${e.msg}` }));
  issuesBox.replaceChildren(errors.length || warnings.length
    ? h("div", { class: "admissues" },
        h("p", { class: "hint", text: `書式チェック：直す必要がある問題 ${errors.length} 件・注意 ${warnings.length} 件（行の番号は articles.csv の行です）` }),
        h("ul", null, ...lines(errors, "直してください", "e"), ...lines(warnings, "注意", "w")))
    : h("p", { class: "ok", text: "書式チェック：問題はありません。" }));
  const L = (href, label, sub, external) => h("li", null, h("a", { href, target: external ? "_blank" : null, rel: external ? "noopener noreferrer" : null },
    h("span", { text: label }), sub ? h("small", { text: sub }) : null));
  links.replaceChildren(...[
    L("maker.html", "記事データ作成ツール", "articles.csv に貼り付ける1行だけを作ります（GitHub で直接編集するとき用）"),
    REPO ? L(`${REPO}/edit/main/data/articles.csv`, "記事データを GitHub で編集する", "articles.csv を開いて、行を貼り付け・修正します", true) : null,
    REPO ? L(`${REPO}/issues`, "届いた依頼・お知らせを見る", "記事の追加のお願いや、リンク切れのお知らせ（GitHub の Issues）", true) : null,
    REPO ? L(`${REPO}/actions`, "サイトの更新とリンク確認の結果", "GitHub の Actions", true) : null,
    REPO ? L(`${REPO}/blob/main/docs/manual.md`, "運用マニュアル", "記事の追加や、困ったときの手順", true) : null
  ].filter(Boolean));
  $("#admRepoNote").hidden = !!REPO;
}

function setAdmin(on) {
  S.admin = on;
  try { if (on) localStorage.setItem(STORE_ADMIN, "1"); else localStorage.removeItem(STORE_ADMIN); } catch { /* 保存できない環境 */ }
  render();
  toast(on ? "この端末を管理者モードにしました" : "管理者モードをオフにしました");
}

/* ---------- 記事を追加（追加のお願いを GitHub の Issue で送る） ---------- */

function renderAdd() {
  $("#addAdminNote").hidden = !S.admin;
  updateAddLink();
}
function updateAddLink() {
  const a = $("#addSend");
  const url = $("#addUrl").value.trim(), title = $("#addTitle").value.trim(), note = $("#addNote").value.trim();
  const okUrl = /^https?:\/\/\S+$/i.test(url);
  if (!REPO) {
    a.setAttribute("aria-disabled", "true");
    a.removeAttribute("href");
    $("#addHint").textContent = "このページから送るには、サイトを GitHub Pages で公開している必要があります。";
    return;
  }
  if (!okUrl) {
    a.setAttribute("aria-disabled", "true");
    a.removeAttribute("href");
    $("#addHint").textContent = url ? "URL は https:// から始まる形で入れてください。" : "記事の URL を入れると、送れるようになります。送るには GitHub のアカウント（無料）が必要です。";
    return;
  }
  const body = `記事の URL：${url}\nタイトル：${title || "（不明）"}\n\nひとこと：\n${note}\n`;
  a.href = `${REPO}/issues/new?title=${encodeURIComponent("記事の追加のお願い：" + (title || url))}&body=${encodeURIComponent(body)}`;
  a.removeAttribute("aria-disabled");
  $("#addHint").textContent = "押すと GitHub の画面が開きます。内容を確かめて「Submit new issue」を押すと送られます（GitHub のアカウントが必要です）。";
}
["#addUrl", "#addTitle", "#addNote"].forEach((s) => $(s).addEventListener("input", updateAddLink));
$("#addForm").addEventListener("submit", (e) => e.preventDefault());
$("#addSend").addEventListener("click", (e) => { if ($("#addSend").getAttribute("aria-disabled") === "true") e.preventDefault(); });

/* ---------- お気に入り・あとで読む・既読 ---------- */

const MARK_CLASS = { bm: "is-bm", lt: "is-lt", rd: "is-read" };
function setMark(kind, id, on, li) {
  if (on) S.marks[kind][id] = 1; else delete S.marks[kind][id];
  if (li) {
    li.classList.toggle(MARK_CLASS[kind], on);
    const b = li.querySelector(`[data-act="${kind}"]`);
    if (b) b.setAttribute("aria-pressed", String(on));
  }
  saveMarks();
  renderStats();
  renderMenu();
  if (S.view.cat === "later" && kind === "lt") renderHead();
}

/* ---------- バックアップ（書き出し・読み込み） ---------- */

function backupMsg(text, isErr) {
  const p = $("#backupMsg");
  p.textContent = text;
  p.classList.toggle("err", !!isErr);
}

function exportMarks() {
  const data = {
    app: "radwimps-interview-index", version: 2, exportedAt: new Date().toISOString(),
    bookmarks: Object.keys(S.marks.bm), later: Object.keys(S.marks.lt), read: Object.keys(S.marks.rd)
  };
  const d = new Date();
  const name = `radwimps-index-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  backupMsg(`お気に入り ${data.bookmarks.length} 件・あとで読む ${data.later.length} 件・既読 ${data.read.length} 件をファイルに書き出しました。`);
}

async function importMarks(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || data.app !== "radwimps-interview-index") throw new Error("not a backup");
    const ids = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.length < 160) : []);
    const add = (kind, list) => { let n = 0; for (const id of ids(list)) if (!S.marks[kind][id]) { S.marks[kind][id] = 1; n++; } return n; };
    const nb = add("bm", data.bookmarks), nl = add("lt", data.later), nr = add("rd", data.read);
    saveMarks();
    render();
    backupMsg(`読み込みました（お気に入り ${nb} 件・あとで読む ${nl} 件・既読 ${nr} 件を追加）。今ある記録はそのまま残ります。`);
  } catch {
    backupMsg("このファイルは読み込めませんでした。このサイトで書き出したバックアップファイルを選んでください。", true);
  }
}

/* ---------- 操作 ---------- */

let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}

const appbar = $("#appbar");
const barH = () => appbar.offsetHeight;

// 指定した位置まで移動する（遠いときは、なめらかに動かさずにすぐ移動する）
function jumpTo(top) {
  const far = Math.abs(top - window.scrollY) > innerHeight * 3;
  window.scrollTo({ top: Math.max(0, top), behavior: reduceMotion() || far ? "auto" : "smooth" });
}
function scrollToList() {
  const top = $("#main").getBoundingClientRect().top + window.scrollY - barH();
  if (window.scrollY > top) jumpTo(top);
}

function resetFilters() {
  S.q = "";
  $("#q").value = "";
  S.f.w.clear(); S.f.k.clear(); S.f.y.clear(); S.f.tag.clear(); S.f.lang = "";
  S.sort = "desc";
  saveUI();
  render();
}

let qTimer = null;
$("#q").addEventListener("input", (e) => {
  clearTimeout(qTimer);
  const v = e.target.value;
  qTimer = setTimeout(() => { S.q = v; render(); }, 120);
});
$("#q").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });
$("#qclear").addEventListener("click", () => { S.q = ""; $("#q").value = ""; render(); $("#q").focus(); });

document.querySelector(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest(".tab");
  if (!b) return;
  S.tab = b.dataset.tab;
  saveUI();
  render();
  scrollToList();
});

// 絞り込みのパネル（開いている間は、うしろの一覧を動かさない）
function setFiltersOpen(open) {
  const sheet = $("#filters");
  if (open === !sheet.hidden) return;
  sheet.hidden = !open;
  document.documentElement.classList.toggle("locked", open);
  $("#ftoggle").setAttribute("aria-expanded", String(open));
  if (open) $("#fClose").focus();
  else $("#ftoggle").focus({ preventScroll: true });
}
$("#ftoggle").addEventListener("click", () => setFiltersOpen(true));
$("#fClose").addEventListener("click", () => setFiltersOpen(false));
$("#fBack").addEventListener("click", () => setFiltersOpen(false));
$("#fDone").addEventListener("click", () => { setFiltersOpen(false); scrollToList(); });
$("#fReset").addEventListener("click", resetFilters);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#menuWrap").hidden) { setMenuOpen(false); return; }
  const sheet = $("#filters");
  if (sheet.hidden) return;
  if (e.key === "Escape") { setFiltersOpen(false); return; }
  if (e.key !== "Tab") return;
  // Tab キーでの移動を、パネルの中だけにとどめる
  const els = [...sheet.querySelectorAll("button:not(:disabled), [href], input, select")].filter((x) => x.offsetParent !== null);
  if (!els.length) return;
  const first = els[0], last = els[els.length - 1];
  if (e.shiftKey && (document.activeElement === first || !sheet.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (document.activeElement === last || !sheet.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
});

$("#fgroups").addEventListener("click", (e) => {
  const c = e.target.closest(".chip");
  if (!c || c.disabled) return;
  const g = c.dataset.g, v = c.dataset.v;
  if (g === "sort") S.sort = v;
  else if (g === "lang") S.f.lang = S.f.lang === v ? "" : v;
  else if (S.f[g].has(v)) S.f[g].delete(v);
  else S.f[g].add(v);
  saveUI();
  render();
});

$("#active").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const g = b.dataset.g, v = b.dataset.v;
  if (g === "all") return resetFilters();
  if (g === "q") { S.q = ""; $("#q").value = ""; }
  else if (g === "sort") S.sort = "desc";
  else if (g === "lang") S.f.lang = "";
  else S.f[g].delete(v);
  saveUI();
  render();
});

// 「年へ移動」：選んだ年の見出しまで移動して、選択を元に戻す
$("#yearjump").addEventListener("change", (e) => {
  const sec = e.target.value && document.getElementById("y-" + e.target.value);
  e.target.value = "";
  if (sec) jumpTo(sec.getBoundingClientRect().top + window.scrollY - barH());
});

// 「上へ戻る」ボタン：一覧を2画面ぶん以上進んだら出す
const toTop = $("#toTop");
let topTick = false;
window.addEventListener("scroll", () => {
  if (topTick) return;
  topTick = true;
  requestAnimationFrame(() => { toTop.hidden = window.scrollY < innerHeight * 2; topTick = false; });
}, { passive: true });
toTop.addEventListener("click", () => {
  jumpTo(0);
  $("#top").focus({ preventScroll: true });
});

$("#list").addEventListener("click", (e) => {
  const t = e.target.closest("button, a");
  if (!t) return;
  if (t.dataset.act === "reset") return resetFilters();
  const li = t.closest(".item");
  const id = li && li.dataset.id;
  if (t.matches("a.title, a.thumb")) {
    if (id && !S.marks.rd[id]) setMark("rd", id, true, li); // 記事を開いたら既読にする
    return;
  }
  const act = t.dataset.act;
  if (act === "bm" || act === "lt" || act === "rd") {
    const on = !S.marks[act][id];
    setMark(act, id, on, li);
    toast({
      bm: on ? "お気に入りに入れました" : "お気に入りから外しました",
      lt: on ? "あとで読むに入れました" : "あとで読むから外しました",
      rd: on ? "既読にしました" : "未読に戻しました"
    }[act]);
  } else if (t.classList.contains("tag")) {
    S.f.tag.add(t.dataset.tag);
    saveUI();
    render();
    scrollToList();
    toast(`「${t.dataset.tag}」で絞り込みました`);
  }
});
$("#list").addEventListener("auxclick", (e) => { // 中クリックで開いたときも既読にする
  const a = e.target.closest("a.title, a.thumb");
  const li = a && e.button === 1 ? a.closest(".item") : null;
  if (li && !S.marks.rd[li.dataset.id]) setMark("rd", li.dataset.id, true, li);
});

// マイページ・管理画面のボタン
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-go], [data-act='admin-on'], [data-act='admin-off']");
  if (!b) return;
  if (b.dataset.act === "admin-on") return setAdmin(true);
  if (b.dataset.act === "admin-off") return setAdmin(false);
  if (b.dataset.go === "bm") { // マイページの「お気に入り」：すべての記事の★のタブへ
    S.tab = "bm";
    saveUI();
    if (location.hash === "#articles") render(); else location.hash = "#articles";
  }
});

/* ---------- メニュー（左上のボタン） ----------
   動きの参考：Motion Prompt #065 ハンバーガーメニュー（MIT License © 2026 Shohei Ohtaki）
   ボタンの3本線が「×」に変わり（上下の線が中央へ寄って ±45° 回転、真ん中の線は消える）、
   メニューが帯の下から 0.3 秒で降りてきます（動きの速さの変化は easeInOutCubic）。 */
const menuWrap = $("#menuWrap"), menuBtn = $("#menuBtn");
let menuTimer = null;
function setMenuOpen(open, { focusBack = true } = {}) {
  const isOpen = menuBtn.getAttribute("aria-expanded") === "true";
  if (open === isOpen) return;
  clearTimeout(menuTimer);
  menuBtn.setAttribute("aria-expanded", String(open));
  menuBtn.setAttribute("aria-label", open ? "メニューを閉じる" : "メニューを開く");
  document.documentElement.classList.toggle("locked", open);
  if (open) {
    menuWrap.hidden = false;
    menuWrap.getBoundingClientRect(); // 一度描いてから動かす
    menuWrap.classList.add("open");
    const cur = menuWrap.querySelector('[aria-current="page"]') || menuWrap.querySelector("a");
    if (cur) cur.focus({ preventScroll: true });
  } else {
    menuWrap.classList.remove("open");
    menuTimer = setTimeout(() => { menuWrap.hidden = true; }, reduceMotion() ? 0 : 320);
    if (focusBack) menuBtn.focus({ preventScroll: true });
  }
}
menuBtn.addEventListener("click", () => setMenuOpen(menuBtn.getAttribute("aria-expanded") !== "true"));
$("#menuCatch").addEventListener("click", () => setMenuOpen(false));
$("#menuIn").addEventListener("click", (e) => {
  const a = e.target.closest("a");
  if (!a) return;
  setMenuOpen(false, { focusBack: false });
  if (a.getAttribute("href") === location.hash) { jumpTo(0); $("#top").focus({ preventScroll: true }); } // 今のページを押したときは上へ
});
// メニューの外（タブキーなど）にフォーカスが出たら閉じる
menuWrap.addEventListener("focusout", (e) => {
  if (menuBtn.getAttribute("aria-expanded") === "true" && e.relatedTarget && !menuWrap.contains(e.relatedTarget) && e.relatedTarget !== menuBtn) setMenuOpen(false, { focusBack: false });
});

// ページの切り替え（メニューのリンクは #○○ へのリンク）
window.addEventListener("hashchange", () => {
  const prev = S.view && S.view.key;
  S.view = viewFromHash();
  if (S.view.key === prev) return;
  setMenuOpen(false, { focusBack: false });
  render();
  window.scrollTo({ top: 0, behavior: "auto" });
  $("#top").focus({ preventScroll: true });
});

// バックアップ
$("#exportBtn").addEventListener("click", exportMarks);
$("#importBtn").addEventListener("click", () => $("#importFile").click());
$("#importFile").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) importMarks(file);
  e.target.value = "";
});

// 固定した帯の影と高さ（年の見出しとメニューの位置に使う）
new IntersectionObserver(([en]) => appbar.classList.toggle("stuck", !en.isIntersecting)).observe($("#sentinel"));
const setBarH = () => document.documentElement.style.setProperty("--barH", barH() + "px");
new ResizeObserver(setBarH).observe(appbar);
setBarH();

// 「誤りやリンク切れを知らせる」リンク：GitHub の Issue 作成ページへ
if (REPO) {
  const body = "記事のタイトル：\n掲載元の URL：\n\n気づいたこと（リンク切れ・内容の誤りなど）：\n";
  $("#report").href = `${REPO}/issues/new?title=${encodeURIComponent("記事についての連絡")}&body=${encodeURIComponent(body)}`;
  $("#reportRow").hidden = false;
}

render();
loadData();
