// assets/app.js
// 画面の動きを担当するプログラムです。
//   1. data/articles.csv（記事）と data/releases.csv（年ごとの主なリリース）を読み込む
//   2. 探す入口（人・曲や作品・年代・ライブ）、検索、種類のタブ、「さらに絞り込む」で記事一覧を絞り込む
//   3. 記事をカードで表示する（12件ずつ。「続きを表示」で12件ずつ増やす）
//   4. 「あとで読む」と「既読」を、このブラウザに保存する（「保存データの管理」でファイルへの書き出し・読み込みも）
//   5. 運営管理（URL の末尾に #admin）：記事の追加・修正を GitHub に保存する（中身は assets/admin.js）
// 記事を増やしたり直したりするときは、このファイルではなく data/articles.csv を編集します。
// 絞り込みの状態は URL（例：?person=野田洋次郎&format=all）に入るので、そのままブックマークや共有ができます。

import config from "./config.js";
import {
  parseArticles, parseReleases, KIND_ORDER, MEMBERS, MEMBER_ORDER, CATEGORIES, SUPPORT_MEMBERS, WORKS, QUICK_WORKS,
  VIDEO_KIND, LIVE_KIND, LANG_BADGE, youtubeId
} from "./data.js";

/* ---------- 共通の道具 ---------- */

const STORE_MARKS = "radwimps-interview-index:marks"; // あとで読む・既読の保存場所の名前（以前の「お気に入り」もここ）
const STORE_ADMIN = "radwimps-interview-index:admin"; // 管理者モード（この端末だけの設定）
const PAGE_SIZE = 12;                                 // 一覧に一度に出す件数

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const isWide = () => matchMedia("(min-width: 701px)").matches;
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
// HTML に文字を入れるときの安全な書き方（< や " をそのまま入れない）
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 保存できない環境では何もしない */ } }

// 検索用に文字をそろえる：全角半角・大文字小文字・ひらがなとカタカナの違いをなくし、記号や空白を取り除く
const STRIP = /[\s　・、，,。．.／/「」『』【】〔〕［］[\]（）()<>＜＞〈〉《》\-‐–—―_~〜～!！?？:：;；'"“”‘’`*＊#＃|｜×✕+＋&＆]/g;
function norm(s) {
  return String(s || "").normalize("NFKC").toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(STRIP, "");
}
// 日付を「2026.10.24」「2026.10」「2026」の形にする
const dotDate = (d) => (d ? d.replaceAll("-", ".") : "");

/* ---------- 状態 ---------- */

// 絞り込みの条件（空欄は「条件なし」）。この名前のまま URL に入ります。
const F_DEFAULT = {
  entry: "",    // 開いている入口：people / works / years / live
  person: "",   // 人の名前
  scope: "",    // 人の記事の範囲：""＝本人が語る記事　any＝本人の取材とその人についての話　about＝ほかの人がこの人について語った記事
  work: "",     // 曲・作品の名前
  year: "",     // 記事が公開された年
  tour: "",     // ライブ名（ツアー・イベント）
  q: "",        // キーワード
  format: "text", // 種類のタブ：text＝記事・資料　video＝動画インタビュー　release＝リリース情報　all＝すべて
  cat: "",      // 内容（カテゴリ）
  media: "",    // 掲載メディア
  lang: "",     // 言語（ja / en / es / other）
  kind: "",     // 資料の種類（「種類」列の値）
  status: "",   // 読書の状態：later＝あとで読む　unread＝未読　read＝既読
  sort: "new"   // 並び順：new / old / media
};
const F = { ...F_DEFAULT };

const S = {
  items: [],      // 表示する記事（状態が「公開」のもの）
  parsed: null,   // 記事データを読んだ結果（運営管理で、非表示の行や書式の問題を数えるため）
  releases: {},   // 年ごとの主なリリース
  works: [],      // 「曲・作品から探す」に出す作品（記事があるものだけ）
  people: { members: [], support: [], former: [], others: [] },
  page: "list",   // list：記事一覧　admin：運営管理
  lastEntry: "",  // 最後に開いた入口（パネルを閉じても覚えておき、別の入口に切り替えたときに、前の入口で選んだものを外すため）
  limit: PAGE_SIZE,
  marks: cleanMarks(load(STORE_MARKS)),
  admin: load(STORE_ADMIN) === 1,
  loaded: false,
  updated: ""     // 記事データの最終更新日
};

function cleanMarks(m) {
  const out = { bm: {}, lt: {}, rd: {} }; // lt：あとで読む　rd：既読　bm：以前の「お気に入り（★）」
  for (const key of ["bm", "lt", "rd"]) {
    const src = m && m[key];
    if (src && typeof src === "object") for (const id of Object.keys(src)) if (src[id] && id.length < 160) out[key][id] = 1;
  }
  // 以前の「お気に入り（★）」は、デザインの変更で「あとで読む」にまとめました
  for (const id of Object.keys(out.bm)) out.lt[id] = 1;
  out.bm = {};
  return out;
}
const saveMarks = () => save(STORE_MARKS, S.marks);

/* ---------- URL と絞り込みの条件 ---------- */

const VALID = {
  entry: ["", "people", "works", "years", "live"], scope: ["", "any", "about"], format: ["text", "video", "release", "all"],
  status: ["", "later", "unread", "read"], sort: ["new", "old", "media"]
};
function readURL() {
  const p = new URLSearchParams(location.search);
  for (const k of Object.keys(F_DEFAULT)) {
    let v = p.has(k) ? String(p.get(k)).slice(0, 200) : F_DEFAULT[k];
    if (VALID[k] && !VALID[k].includes(v)) v = F_DEFAULT[k];
    F[k] = v;
  }
}
function writeURL() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(F)) if (v && v !== F_DEFAULT[k]) p.set(k, v);
  const qs = p.toString();
  const hash = S.page === "admin" ? location.hash : "";
  try { history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + hash); } catch { /* 変えられない環境 */ }
}
function resetFilters() { Object.assign(F, F_DEFAULT); S.limit = PAGE_SIZE; S.lastEntry = ""; }

// 入口ごとの「選んだもの」。別の入口に切り替えたら、前の入口で選んだものは外します（探し方は一度に1つ）。
// 「さらに絞り込む」で選んだ内容・メディア・言語・資料の種類・読書の状態と、検索の言葉はそのまま残ります。
const ENTRY_KEYS = { people: ["person", "scope"], works: ["work"], years: ["year"], live: ["tour"] };
// URL から開いたときなど、どの入口で選んだ状態かを条件から決める
const entryOfState = () => F.entry || (F.tour ? "live" : F.person ? "people" : F.work ? "works" : F.year ? "years" : "");

// 以前のサイトの URL（#later・#videos・#c-○○ など）も、そのまま使えるようにする
function readHash() {
  const key = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (key === "admin" || key === "admin-add") return { page: "admin", openNew: key === "admin-add" };
  if (key === "later") { resetFilters(); F.status = "later"; F.format = "all"; }
  else if (key === "videos") { resetFilters(); F.format = "video"; }
  else if (key.startsWith("c-")) {
    const c = CATEGORIES.find((x) => x.slug === key.slice(2));
    if (c) { resetFilters(); F.cat = c.name; }
  } else if (key === "add") return { page: "list", dialog: "add" };
  else if (key === "mypage") return { page: "list", dialog: "backup" };
  return { page: "list", clear: ["later", "videos", "articles"].includes(key) || key.startsWith("c-") };
}

/* ---------- データの読み込み ---------- */

const MEMBER_NAME = Object.fromEntries(MEMBER_ORDER.map((k) => [MEMBERS[k].name, k]));

function prep(it, i) {
  it._i = i;
  it._y = it.date ? it.date.slice(0, 4) : "";
  it._k = it.date ? (it.date + "-00-00").slice(0, 10) : "0000-00-00";
  it._ek = it.eventDate ? (it.eventDate + "-00-00").slice(0, 10) : "";
  const names = it.members.map((k) => [MEMBERS[k].name, MEMBERS[k].romaji, MEMBERS[k].kana].join(" ")).join(" ");
  it._h = norm(["radwimps らっどうぃんぷす", it.title, it.media, names, it.guests.join(" "), it.tags.join(" "), it.categories.join(" "),
    it.note, it.summary, it.kind, it.date, it.eventName, it.venue].join(" "));
  it._w = norm([it.title, it.summary, it.tags.join(" "), it.eventName].join(" "));
  it._tags = new Set(it.tags.map(norm));
  return it;
}

// 記事データ（CSV の文字列）を読んで、表示に使う形にする
function ingest(text) {
  const parsed = parseArticles(text);
  if (parsed.errors.length) console.warn("記事データに書式の問題がある行があります（その行は表示していません）", parsed.errors);
  S.parsed = parsed;
  S.items = parsed.items.filter((it) => it.state === "公開").map(prep);
  buildChoices();
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
    if (dt && !isNaN(dt)) S.updated = `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, "0")}.${String(dt.getDate()).padStart(2, "0")}`;
    $("#updated").textContent = S.updated ? `最終更新 ${S.updated} / 手動更新` : "";
    S.loaded = true;
    $("#loading").hidden = true;
    render();
  } catch (e) {
    console.error(e);
    $("#loading").textContent = "記事データを読み込めませんでした。時間をおいて、ページを開き直してください。";
  }
}

/* ---------- 選択肢（入口と「さらに絞り込む」） ---------- */

const ja = (a, b) => a.localeCompare(b, "ja");
function buildChoices() {
  // 人：メンバー・サポートメンバー・脱退したメンバー・そのほか（共演者・監督・音楽仲間など）
  const has = (name) => S.items.some((it) => personMatch(it, name, "any"));
  const guests = new Set();
  for (const it of S.items) for (const g of it.guests) guests.add(g);
  S.people.members = MEMBER_ORDER.filter((k) => MEMBERS[k].group === "member").map((k) => MEMBERS[k].name).filter(has);
  S.people.former = MEMBER_ORDER.filter((k) => MEMBERS[k].group === "former").map((k) => MEMBERS[k].name).filter(has);
  S.people.support = SUPPORT_MEMBERS.filter((n) => guests.has(n));
  S.people.others = [...guests].filter((n) => !SUPPORT_MEMBERS.includes(n) && !MEMBER_NAME[n]).sort(ja);
  // 曲・作品：記事が1つ以上あるものだけ
  const seen = new Set();
  S.works = WORKS.filter((w) => {
    if (seen.has(w.name)) return false;
    seen.add(w.name);
    return S.items.some((it) => workMatch(it, w.name));
  });
}

function fillSelect(sel, first, options, value) {
  sel.replaceChildren(h("option", { value: "", text: first }), ...options.map(([v, label]) => h("option", { value: v, text: label })));
  sel.value = options.some(([v]) => v === value) ? value : "";
}

const LANG_LABEL = { ja: "日本語", en: "英語", es: "スペイン語", other: "その他の言語" };
const STATUS_LABEL = { later: "あとで読む", unread: "未読", read: "既読" };
function renderSelects() {
  const present = (fn) => [...new Set(S.items.map(fn).flat().filter(Boolean))];
  const cats = present((it) => it.categories);
  fillSelect($("#fCat"), "すべての記事", [...CATEGORIES.map((c) => c.name).filter((n) => cats.includes(n)), ...cats.filter((n) => !CATEGORIES.some((c) => c.name === n))].map((n) => [n, n]), F.cat);
  const people = ["RADWIMPS", ...S.people.members, ...S.people.support, ...S.people.former, ...S.people.others];
  fillSelect($("#fPerson"), "すべての人物", people.map((n) => [n, n]), F.person);
  fillSelect($("#fYear"), "すべての年", present((it) => it._y).sort().reverse().map((y) => [y, y + "年"]), F.year);
  fillSelect($("#fMedia"), "すべてのメディア", present((it) => it.media).sort(ja).map((m) => [m, m]), F.media);
  const langs = present((it) => it.lang);
  fillSelect($("#fLang"), "すべての言語", ["ja", "en", "es", "other"].filter((l) => langs.includes(l)).map((l) => [l, LANG_LABEL[l]]), F.lang);
  const kinds = present((it) => it.kind);
  fillSelect($("#fKind"), "すべての種類", [...KIND_ORDER.filter((k) => kinds.includes(k)), ...kinds.filter((k) => !KIND_ORDER.includes(k))].map((k) => [k, k]), F.kind);
  fillSelect($("#fStatus"), "すべて", Object.entries(STATUS_LABEL), F.status);
  $("#sort").value = F.sort;
}

/* ---------- 絞り込み ---------- */

// 人の記事か：本人が語る（メンバー列・対談相手列にいる）／ほかの人がこの人について語る
function personMatch(it, name, scope) {
  const key = MEMBER_NAME[name];
  const self = key ? it.members.includes(key) : it.guests.includes(name);
  if (scope === "" || !scope) return self;
  const mentioned = it._tags.has(norm(name)) || it._h.includes(norm(name)) || (key && it._h.includes(norm(MEMBERS[key].kana)));
  const about = !self && (key ? it.kind === "ほかの人が語る" && mentioned : mentioned);
  return scope === "about" ? about : self || about;
}

// 曲・作品の記事か：タグにその名前がある、タイトルや説明に「」『』付きで出てくる、または長めの名前がそのまま出てくる
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function workMatch(it, name) {
  const n = norm(name);
  if (!n) return false;
  if (it._tags.has(n)) return true;
  const quoted = new RegExp(`[「『“"]${reEsc(name)}[」』”"]`);
  if (quoted.test(it.title) || quoted.test(it.summary)) return true;
  return [...n].length >= 4 && it._w.includes(n);
}

const terms = () => F.q.split(/[\s　]+/).map(norm).filter(Boolean);
const isLiveView = () => F.entry === "live" || !!F.tour || F.kind === LIVE_KIND;

function passes(it, ts) {
  if (F.format !== "all" && it.format !== F.format && !isLiveView()) return false;
  if (isLiveView() && it.kind !== LIVE_KIND) return false;
  if (F.status === "later" && !S.marks.lt[it.id]) return false;
  if (F.status === "unread" && S.marks.rd[it.id]) return false;
  if (F.status === "read" && !S.marks.rd[it.id]) return false;
  if (F.person && !personMatch(it, F.person, F.scope)) return false;
  if (F.work && !workMatch(it, F.work)) return false;
  if (F.year && it._y !== F.year) return false;
  if (F.tour && it.eventName !== F.tour) return false;
  if (F.cat && !it.categories.includes(F.cat)) return false;
  if (F.media && it.media !== F.media) return false;
  if (F.lang && it.lang !== F.lang) return false;
  if (F.kind && it.kind !== F.kind) return false;
  for (const t of ts) if (!it._h.includes(t)) return false;
  return true;
}

function filtered() {
  const ts = terms();
  const list = S.items.filter((it) => passes(it, ts));
  const dir = F.sort === "old" ? 1 : -1;
  const byDate = (a, b) => (a._k < b._k ? -1 : a._k > b._k ? 1 : 0) * dir || a._i - b._i;
  if (F.sort === "media") return list.sort((a, b) => ja(a.media, b.media) || (a._k < b._k ? 1 : a._k > b._k ? -1 : 0) || a._i - b._i);
  if (isLiveView()) {
    // ライブは公演日の順（公演日がわからない記事は最後に、記事の公開日順）
    return list.sort((a, b) => {
      if (!a._ek !== !b._ek) return a._ek ? -1 : 1;
      if (a._ek !== b._ek) return (a._ek < b._ek ? -1 : 1) * dir;
      return byDate(a, b);
    });
  }
  return list.sort(byDate);
}

/* ---------- 描画：入口のパネル ---------- */

const ENTRY_NOTES = {
  works: "曲の話、制作の裏側、共演者の言葉をまとめて探せます。",
  years: "記事が公開された年で探します。ライブレポートは「ライブから探す」で公演日ごとに読めます。",
  live: "公演日ごとにレポートをまとめています。並び順と「さらに絞り込む」でも絞り込めます。"
};
function chip(attr, value, label, on) {
  return `<button type="button" class="person-chip" ${attr}="${esc(value)}" aria-pressed="${on}">${esc(label ?? value)}</button>`;
}
function renderEntry() {
  for (const b of $$("#entryTabs [data-entry]")) b.setAttribute("aria-expanded", String(F.entry === b.dataset.entry));
  const panel = $("#entryPanel");
  panel.hidden = !F.entry;
  if (!F.entry) { panel.replaceChildren(); return; }
  const keepSearch = panel.querySelector("#personSearch")?.value || "";
  let html = "";
  if (F.entry === "people") {
    const group = (title, names) => names.length ? `<section><h3>${title}</h3><div class="person-chips">${names.map((n) => chip("data-pick-person", n, n, F.person === n)).join("")}</div></section>` : "";
    html = `<label class="panel-label">名前を探す<input type="search" id="personSearch" autocomplete="off" placeholder="例：十明、新海誠、北村匠海" value="${esc(keepSearch)}"></label>`
      + `<div class="person-chips">${chip("data-pick-person", "RADWIMPS", "RADWIMPS", F.person === "RADWIMPS")}</div>`
      + `<div class="person-groups">${group("メンバー", S.people.members)}${group("サポートメンバー", S.people.support)}${group("脱退したメンバー", S.people.former)}`
      + (S.people.others.length ? `<section><details id="otherPeople"${keepSearch || S.people.others.includes(F.person) ? " open" : ""}><summary>共演者・監督・音楽仲間などから選ぶ</summary><div class="person-chips">${S.people.others.map((n) => chip("data-pick-person", n, n, F.person === n)).join("")}</div></details></section>` : "")
      + `</div><p class="panel-empty" id="personNone" hidden>その名前の人は、まだ見つかりません。</p>`
      + (F.person ? `<label class="panel-label">読みたい内容<select id="personScope"><option value="any"${F.scope === "any" ? " selected" : ""}>本人の取材と、その人についての話</option><option value=""${F.scope === "" ? " selected" : ""}>本人が語っている記事</option><option value="about"${F.scope === "about" ? " selected" : ""}>ほかの人がこの人について語った記事</option></select></label>` : "");
  } else if (F.entry === "works") {
    const groups = [...new Set(S.works.map((w) => w.group))];
    const quick = QUICK_WORKS.filter((n) => S.works.some((w) => w.name === n));
    html = `<label class="panel-label">曲・アルバム・映画を選ぶ<select id="workChoice"><option value="">作品を選んでください</option>${groups.map((g) => `<optgroup label="${esc(g)}">${S.works.filter((w) => w.group === g).map((w) => `<option${F.work === w.name ? " selected" : ""}>${esc(w.name)}</option>`).join("")}</optgroup>`).join("")}</select></label>`
      + `<p class="browse-note">${ENTRY_NOTES.works}</p><div class="person-chips">${quick.map((n) => chip("data-pick-work", n, n, F.work === n)).join("")}</div>`;
  } else if (F.entry === "years") {
    const years = [...new Set(S.items.map((it) => it._y).filter(Boolean))].sort().reverse();
    const rel = F.year && S.releases[F.year] ? S.releases[F.year] : [];
    html = `<label class="panel-label">記事が公開された年<select id="yearChoice"><option value="">すべての年</option>${years.map((y) => `<option value="${y}"${F.year === y ? " selected" : ""}>${y}年</option>`).join("")}</select></label>`
      + `<div class="person-chips panel-chips">${years.map((y) => chip("data-pick-year", y, y, F.year === y)).join("")}</div>`
      + (rel.length ? `<p class="browse-note">${esc(F.year)}年の主なリリース：${rel.map((r) => esc((r.label ? r.label + " " : "") + r.name)).join(" ／ ")}</p>` : "")
      + `<p class="browse-note">${ENTRY_NOTES.years}</p>`;
  } else if (F.entry === "live") {
    const tours = new Map();
    for (const it of S.items) if (it.kind === LIVE_KIND && it.eventName) {
      const last = tours.get(it.eventName) || "";
      if (it._ek > last) tours.set(it.eventName, it._ek);
    }
    const list = [...tours.entries()].sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : ja(a[0], b[0])));
    html = `<label class="panel-label">ツアー・イベントを選ぶ<select id="tourChoice"><option value="">すべてのツアー・イベント</option>${list.map(([n]) => `<option${F.tour === n ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></label>`
      + `<p class="browse-note">${ENTRY_NOTES.live}</p>`;
  }
  panel.innerHTML = html;
  if (keepSearch) filterPeople(keepSearch);
}
function filterPeople(text) {
  const n = norm(text);
  let any = false;
  for (const b of $$("#entryPanel [data-pick-person]")) {
    const show = !n || norm(b.dataset.pickPerson).includes(n);
    b.hidden = !show;
    if (show) any = true;
  }
  for (const sec of $$("#entryPanel .person-groups section")) sec.hidden = !!n && !sec.querySelector("[data-pick-person]:not([hidden])");
  const other = $("#otherPeople");
  if (other && n) other.open = true;
  $("#personNone").hidden = any;
}

/* ---------- 描画：記事カード ---------- */

const BOOKMARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.8h11v16.4L12 16.1l-5.5 4.1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const WORK_NAMES = new Set(WORKS.map((w) => w.name));
const GENERIC_TAGS = new Set(["MV出演者", "PR", "インタビュー", "対談", "映画", "タイアップ", "対バン", "ワールドツアー", "フェス・イベント", "劇伴", "ライブ", "ラジオ", "テレビ", "RADWIMPS", "ソロ", "ドラマ", "CM"]);

// カードの左の四角に出す短い言葉（作品名・タグ・ライブ名・人の名前の順に、合うものを選ぶ）
function thumbLabel(it) {
  const memberNames = new Set(Object.keys(MEMBER_NAME));
  return it.tags.find((t) => WORK_NAMES.has(t))
    || it.tags.find((t) => [...t].length <= 12 && !GENERIC_TAGS.has(t) && !/周年$/.test(t) && !memberNames.has(t))
    || it.guests[0]
    || (it.members[0] ? MEMBERS[it.members[0]].name : "")
    || it.media;
}
function thumbnail(it) {
  const yt = youtubeId(it.url);
  const label = thumbLabel(it);
  const long = [...label].length > 9 ? " long" : "";
  const img = yt ? `<img src="https://i.ytimg.com/vi/${encodeURIComponent(yt)}/mqdefault.jpg" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-thumb>` : "";
  return `<div class="card-thumbnail" aria-hidden="true"><div class="thumbnail-fallback${long}"><strong>${esc(label)}</strong></div>${img}</div>`;
}
function linkify(text) {
  return esc(text).replace(/https?:\/\/[^\s<>"']+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u.length > 48 ? u.slice(0, 46) + "…" : u}</a>`);
}
function whoLine(it) {
  const names = (list) => esc(list.join("・"));
  if (it.kind === "ほかの人が語る" && it.guests.length) return `<p class="mention-context"><span>語り手</span>${names(it.guests)}</p>`;
  if (it.kind === "対談・鼎談" && it.guests.length) return `<p class="mention-context"><span>対談</span>${names([...it.members.filter((k) => k !== "band").map((k) => MEMBERS[k].name), ...it.guests])}</p>`;
  if (it.kind === LIVE_KIND && it.guests.length) return `<p class="mention-context"><span>共演</span>${names(it.guests)}</p>`;
  return "";
}
function card(it) {
  const saved = !!S.marks.lt[it.id], read = !!S.marks.rd[it.id];
  const isVideo = it.kind === VIDEO_KIND, isLive = it.kind === LIVE_KIND;
  const category = [isVideo ? "▶ 動画" : "", it.categories.join("・"), it.kind !== "インタビュー" && !isVideo ? it.kind : ""].filter(Boolean).join(" · ");
  const date = it.date ? dotDate(it.date) : "日付不明";
  const hasMore = it.summary || it.note || it.tags.length;
  const isReference = /^参考資料/.test(it.note);
  const report = REPO ? `<a class="card-report" href="${esc(issueUrl("記事の誤り・リンク切れ：" + it.title, `記事：${it.title}\nURL：${it.url}\nid：${it.id}\n\n気づいたこと：\n`))}" target="_blank" rel="noopener noreferrer">この記事の誤り・リンク切れを知らせる ↗</a>` : "";
  return `<article class="article-card${isVideo ? " is-video" : ""}${read ? " is-read" : ""}" data-id="${esc(it.id)}" aria-label="${esc(it.title)}">`
    + (read ? '<span class="read-label">✓ 既読</span>' : "")
    + `<div class="card-top"><time class="card-date"${it.date ? ` datetime="${esc(it.date)}"` : ""}>${isLive && it.date ? "記事公開：" : ""}${esc(date)}</time>`
    + `<div class="card-actions"><button type="button" class="save-button" data-act="later" aria-pressed="${saved}" aria-label="${esc(it.title)}を${saved ? "あとで読むから外す" : "あとで読むに保存"}">${BOOKMARK}</button></div></div>`
    + `<div class="card-main">${thumbnail(it)}<div class="card-copy">`
    + (category ? `<p class="card-category">${esc(category)}</p>` : "")
    + `<h3 class="card-title"><a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer" data-open>${esc(it.title)}<span class="sr">（新しいタブで開きます）</span></a></h3>`
    + whoLine(it) + `</div></div>`
    + (it.eventDate ? `<p class="event-meta">公演 ${esc(dotDate(it.eventDate))}${it.venue ? " · " + esc(it.venue) : ""}</p>` : "")
    + (hasMore ? `<details class="card-description"><summary><span class="description-toggle"><span class="when-closed">説明を開く</span><span class="when-open">説明を閉じる</span><span class="chev" aria-hidden="true">⌄</span></span></summary><div class="card-description-body">`
      + (it.summary ? `<p class="card-summary">${esc(it.summary)}</p>` : "")
      + (it.note ? `<p class="${isReference ? "reference-note" : "card-note"}">${linkify(it.note)}</p>` : "")
      + (it.tags.length ? `<ul class="card-tags" aria-label="タグ">${it.tags.map((t) => `<li><button type="button" data-tag="${esc(t)}">#${esc(t)}</button></li>`).join("")}</ul>` : "")
      + report + `</div></details>` : "")
    + `<div class="card-bottom"><button type="button" class="read-button" data-act="read" aria-pressed="${read}"><span aria-hidden="true">${read ? "✓" : "○"}</span>${read ? "既読" : "既読にする"}</button>`
    + `<a class="source-link" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer" data-open aria-label="${esc(it.media)}で読む（新しいタブで開きます）"><span class="source-name">${esc(it.media)}</span>${LANG_BADGE[it.lang] ? `<span class="lang-tag">${LANG_BADGE[it.lang]}</span>` : ""}<span class="arrow" aria-hidden="true">↗</span></a></div>`
    + `</article>`;
}

/* ---------- 描画：一覧 ---------- */

function liveGroups(list) {
  const groups = [];
  const byKey = new Map();
  for (const it of list) {
    const key = it.eventDate ? [it.eventDate, it.eventName, it.venue].join("|") : "?";
    if (!byKey.has(key)) { const g = { key, items: [] }; byKey.set(key, g); groups.push(g); }
    byKey.get(key).items.push(it);
  }
  return groups;
}
function groupHtml(g) {
  const a = g.items[0];
  const head = g.key === "?"
    ? `<time>公演日を確認中</time><div><h3>公演情報がまだない記事</h3><p>公演日・会場がわかったら、記事データに書き足します（記事の公開日順）。</p></div>`
    : `<time datetime="${esc(a.eventDate)}">${esc(dotDate(a.eventDate))}</time><div><h3>${esc(a.eventName || "ライブ名を確認中")}</h3><p>${esc(a.venue || "")}${a.guests.length ? " ／ 共演：" + esc(a.guests.join("・")) : ""}</p></div>`;
  return `<section class="live-event" aria-label="${esc((a.eventDate ? dotDate(a.eventDate) + " " : "") + (a.eventName || "公演情報がまだない記事"))}"><div class="live-event-heading">${head}</div><div class="article-grid">${g.items.map(card).join("")}</div></section>`;
}

function headingText() {
  if (F.status === "later") return "あとで読む";
  if (isLiveView()) return F.tour || "ライブレポート";
  if (F.person) return `${F.person}の記事`;
  if (F.work) return `「${F.work}」の記事`;
  if (F.year) return `${F.year}年の記事`;
  if (F.cat) return F.cat;
  if (F.format === "video") return "動画インタビュー";
  if (F.format === "release") return "リリース情報";
  return "新しく掲載された記事";
}
function viewNote() {
  if (F.status === "later") return "「あとで読む」に保存した記事です。このブラウザに保存しています。";
  if (F.cat) return CATEGORIES.find((c) => c.name === F.cat)?.desc || "";
  if (F.format === "video" && !isLiveView()) return "インタビュー・対談の映像です。リンクから YouTube などを新しいタブで開きます。";
  if (F.format === "release" && !isLiveView()) return "発売・公開のお知らせや、雑誌の掲載号の案内です。インタビュー本文ではありません。";
  return "";
}

function activeChips() {
  const out = [];
  const add = (key, label) => out.push(`<button type="button" data-clear="${key}" aria-label="${esc(label)}の条件を外す">${esc(label)} ×</button>`);
  if (F.q) add("q", `“${F.q}”`);
  if (F.person) add("person", F.person + (F.scope === "about" ? "（ほかの人が語る）" : F.scope === "any" ? "（について語る話も）" : ""));
  if (F.work) add("work", F.work);
  if (F.year) add("year", F.year + "年");
  if (F.tour) add("tour", F.tour);
  if (F.cat) add("cat", F.cat);
  if (F.media) add("media", F.media);
  if (F.lang) add("lang", LANG_LABEL[F.lang] || F.lang);
  if (F.kind) add("kind", F.kind);
  if (F.status) add("status", STATUS_LABEL[F.status]);
  return out.join("");
}

function render() {
  const listMode = S.page === "list";
  $("#listView").hidden = !listMode;
  $("#page-admin").hidden = listMode;
  renderMenu();
  if (!listMode) { renderAdmin(); writeURL(); return; }

  // 上の部品の状態を、条件に合わせる
  for (const b of $$("#formatTabs [data-format]")) b.setAttribute("aria-pressed", String(!isLiveView() && F.format === b.dataset.format));
  if ($("#q").value !== F.q) $("#q").value = F.q;
  $("#qclear").hidden = !F.q;
  if (!S.loaded) return;
  renderEntry();
  renderSelects();
  const n = ["cat", "person", "year", "media", "lang", "kind", "status"].filter((k) => F[k]).length;
  $("#filterNumber").textContent = n ? String(n) : "";
  $("#archiveTitle").textContent = headingText();
  const note = viewNote();
  $("#viewNote").textContent = note;
  $("#viewNote").hidden = !note;
  $("#activeFilters").innerHTML = activeChips();
  $("#liveControls").hidden = !isLiveView();

  // 一覧
  const list = filtered();
  const grid = $("#grid");
  let shown = 0;
  if (isLiveView() && F.sort !== "media") {
    const groups = liveGroups(list);
    const parts = [];
    for (const g of groups) {
      if (shown >= S.limit) break; // 公演の途中で切らないよう、まとまりごとに出す
      parts.push(groupHtml(g));
      shown += g.items.length;
    }
    grid.className = "live-list";
    grid.innerHTML = parts.join("");
  } else {
    grid.className = "article-grid";
    const page = list.slice(0, S.limit);
    shown = page.length;
    grid.innerHTML = page.map(card).join("");
  }
  for (const img of grid.querySelectorAll("img[data-thumb]")) img.addEventListener("error", () => img.remove(), { once: true });
  $("#loadMore").hidden = shown >= list.length;
  $("#empty").hidden = list.length > 0;
  $("#emptyText").textContent = F.status === "later" && !list.length && !F.q
    ? "まだ「あとで読む」に保存した記事はありません。カードの右上のしおりを押すと、ここに集まります。"
    : "条件を変えて、もう一度探してみてください。";
  $("#resultCount").textContent = `${list.length} 件の記事`;
  writeURL();
}

// 条件を変えたときの共通の処理（表示件数を最初に戻して描き直す）
function apply() { S.limit = PAGE_SIZE; render(); }
function scrollToList() {
  const el = $("#archiveTitle");
  el.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
  el.focus({ preventScroll: true });
}

/* ---------- メニュー ---------- */

function renderMenu() {
  $("#laterCount").textContent = String(Object.keys(S.marks.lt).filter((id) => S.items.some((it) => it.id === id)).length || Object.keys(S.marks.lt).length);
  $("#adminLink").hidden = !S.admin;
  const cur = S.page === "admin" ? "admin" : F.status === "later" ? "later" : "list";
  for (const a of $$("#menuClip [data-go]")) {
    if (a.dataset.go === cur) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  if (cur === "admin") $("#adminLink").setAttribute("aria-current", "page"); else $("#adminLink").removeAttribute("aria-current");
}
function setMenuOpen(open, { focusBack = true } = {}) {
  const btn = $("#menuBtn"), clip = $("#menuClip");
  btn.setAttribute("aria-expanded", String(open));
  btn.setAttribute("aria-label", open ? "メニューを閉じる" : "メニューを開く");
  clip.classList.toggle("open", open);
  clip.setAttribute("aria-hidden", String(!open));
  if (open) clip.removeAttribute("inert"); else clip.setAttribute("inert", "");
  if (!open && focusBack && clip.contains(document.activeElement)) btn.focus();
}
$("#menuBtn").addEventListener("click", () => setMenuOpen($("#menuBtn").getAttribute("aria-expanded") !== "true"));
document.addEventListener("click", (e) => {
  if ($("#menuBtn").getAttribute("aria-expanded") === "true" && !e.target.closest("#menuClip, #menuBtn")) setMenuOpen(false, { focusBack: false });
});
$("#menuClip").addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (!go) return;
  e.preventDefault();
  setMenuOpen(false, { focusBack: false });
  goList(() => { if (go.dataset.go === "later") { F.status = "later"; F.format = "all"; } });
});
$("#adminLink").addEventListener("click", () => setMenuOpen(false, { focusBack: false }));

// 記事一覧に戻る（条件はいったん空にしてから、change で必要な条件を入れる）
function goList(change) {
  resetFilters();
  if (change) change();
  S.page = "list";
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  render();
  window.scrollTo({ top: 0, behavior: "auto" });
}
$("#brand").addEventListener("click", (e) => { e.preventDefault(); setMenuOpen(false, { focusBack: false }); goList(); });

/* ---------- 入口・検索・タブ・絞り込みの操作 ---------- */

$("#entryTabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-entry]");
  if (!b) return;
  const entry = b.dataset.entry;
  // 開いている入口をもう一度押すと、パネルを閉じるだけ（選んだものはそのまま）
  if (F.entry === entry) { F.entry = ""; apply(); return; }
  const prev = F.entry || S.lastEntry;
  if (prev && prev !== entry) for (const key of ENTRY_KEYS[prev]) F[key] = F_DEFAULT[key];
  F.entry = S.lastEntry = entry;
  apply();
});
$("#entryPanel").addEventListener("click", (e) => {
  const p = e.target.closest("[data-pick-person]"), w = e.target.closest("[data-pick-work]"), y = e.target.closest("[data-pick-year]");
  if (p) { const v = p.dataset.pickPerson; F.person = F.person === v ? "" : v; if (!F.person) F.scope = ""; apply(); }
  else if (w) { const v = w.dataset.pickWork; F.work = F.work === v ? "" : v; apply(); }
  else if (y) { const v = y.dataset.pickYear; F.year = F.year === v ? "" : v; apply(); }
});
$("#entryPanel").addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "personScope") F.scope = t.value;
  else if (t.id === "workChoice") F.work = t.value;
  else if (t.id === "yearChoice") F.year = t.value;
  else if (t.id === "tourChoice") F.tour = t.value;
  else return;
  apply();
});
$("#entryPanel").addEventListener("input", (e) => { if (e.target.id === "personSearch") filterPeople(e.target.value); });

let qTimer = null;
$("#q").addEventListener("input", () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { F.q = $("#q").value.trim().slice(0, 200); apply(); }, 180);
});
$("#q").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#q").blur(); } });
$("#qclear").addEventListener("click", () => { F.q = ""; apply(); $("#q").focus(); });
// 「/」キーで検索欄へ（ほかの入力欄に書いているときは何もしない）
document.addEventListener("keydown", (e) => {
  if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || S.page !== "list") return;
  const t = e.target;
  if (t.closest("input, textarea, select, [contenteditable='true']") || $("#modal").open) return;
  e.preventDefault();
  $("#q").focus();
});

$("#formatTabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-format]");
  if (!b) return;
  F.format = b.dataset.format;
  if (isLiveView()) { F.entry = F.entry === "live" ? "" : F.entry; F.tour = ""; if (F.kind === LIVE_KIND) F.kind = ""; }
  apply();
});

const SELECT_KEYS = { fCat: "cat", fPerson: "person", fYear: "year", fMedia: "media", fLang: "lang", fKind: "kind", fStatus: "status", sort: "sort" };
for (const [id, key] of Object.entries(SELECT_KEYS)) {
  $("#" + id).addEventListener("change", (e) => {
    F[key] = e.target.value;
    if (key === "person" && !F.person) F.scope = "";
    apply();
  });
}
$("#activeFilters").addEventListener("click", (e) => {
  const b = e.target.closest("[data-clear]");
  if (!b) return;
  const key = b.dataset.clear;
  F[key] = F_DEFAULT[key];
  if (key === "person") F.scope = "";
  apply();
});
$("#loadMore").addEventListener("click", () => {
  const before = $$("#grid .article-card").length;
  S.limit += PAGE_SIZE;
  render();
  $$("#grid .article-card")[before]?.querySelector("a")?.focus({ preventScroll: true });
});

// スマホでは「さらに絞り込む」をたたんでおく（パソコンでは、いつも開いたまま）
const filterPanel = $("#filterPanel");
function syncFilterPanel() { filterPanel.open = isWide(); }
matchMedia("(min-width: 701px)").addEventListener("change", syncFilterPanel);
filterPanel.querySelector("summary").addEventListener("click", (e) => { if (isWide()) e.preventDefault(); });

/* ---------- あとで読む・既読 ---------- */

function setMark(kind, id, on) {
  if (on) S.marks[kind][id] = 1; else delete S.marks[kind][id];
  saveMarks();
  renderMenu();
  const needsRedraw = (kind === "lt" && F.status === "later") || (kind === "rd" && (F.status === "unread" || F.status === "read"));
  if (needsRedraw) { render(); return; }
  // カードだけをその場で直す（一覧が動かないように）
  for (const el of $$(`#grid .article-card[data-id="${CSS.escape(id)}"]`)) {
    const it = S.items.find((x) => x.id === id);
    if (!it) continue;
    const open = el.querySelector(".card-description")?.open;
    el.outerHTML = card(it);
    if (open) $(`#grid .article-card[data-id="${CSS.escape(id)}"] .card-description`).open = true;
  }
}
$("#grid").addEventListener("click", (e) => {
  const cardEl = e.target.closest(".article-card");
  if (!cardEl) return;
  const id = cardEl.dataset.id;
  const act = e.target.closest("[data-act]");
  const tag = e.target.closest("[data-tag]");
  if (act && act.dataset.act === "later") { const on = !S.marks.lt[id]; setMark("lt", id, on); toast(on ? "あとで読むに保存しました" : "あとで読むから外しました"); return; }
  if (act && act.dataset.act === "read") { setMark("rd", id, !S.marks.rd[id]); return; }
  if (tag) { F.q = tag.dataset.tag; apply(); scrollToList(); return; }
  // 記事を開いたら、既読にする
  if (e.target.closest("[data-open]") && !S.marks.rd[id]) setTimeout(() => setMark("rd", id, true), 0);
});
// 中ボタンで開いたときも既読にする
$("#grid").addEventListener("auxclick", (e) => {
  const cardEl = e.target.closest(".article-card");
  if (e.button === 1 && cardEl && e.target.closest("[data-open]") && !S.marks.rd[cardEl.dataset.id]) setMark("rd", cardEl.dataset.id, true);
});

// ランダムに読む：いまの条件に合う記事から1つを、新しいタブで開いて既読にする
// （ボタンは本物のリンク。押した瞬間に行き先を差し替えるので、ポップアップを止める設定のブラウザでも開けます）
function openRandom(e, link) {
  const list = filtered();
  if (!list.length) { e.preventDefault(); toast("いまの条件に合う記事がありません"); return; }
  const it = list[Math.floor(Math.random() * list.length)];
  link.href = it.url;
  setTimeout(() => link.setAttribute("href", "#"), 0);
  setMark("rd", it.id, true);
  toast(`開きました：${it.title.length > 28 ? it.title.slice(0, 27) + "…" : it.title}`);
}

/* ---------- 小窓（保存データの管理・収録方針・記事を追加） ---------- */

let modalBack = null;
function openModal(nodes) {
  modalBack = document.activeElement;
  $("#modalBody").replaceChildren(...nodes);
  const m = $("#modal");
  if (!m.open) m.showModal();
  $("#modalClose").focus();
}
function closeModal() { const m = $("#modal"); if (m.open) m.close(); }
$("#modalClose").addEventListener("click", closeModal);
$("#modal").addEventListener("click", (e) => { if (e.target === $("#modal")) closeModal(); });
$("#modal").addEventListener("close", () => { if (modalBack && document.contains(modalBack)) modalBack.focus(); modalBack = null; });

function showBackup() {
  const count = (k) => Object.keys(S.marks[k]).length;
  const msg = h("p", { class: "msg", role: "status", id: "backupMsg" });
  const file = h("input", { type: "file", accept: ".json,application/json", hidden: true });
  const exportBtn = h("button", { type: "button", class: "btn primary", text: "ファイルに書き出す" });
  const importBtn = h("button", { type: "button", class: "btn", text: "ファイルから読み込む" });
  exportBtn.addEventListener("click", () => exportMarks(msg));
  importBtn.addEventListener("click", () => file.click());
  file.addEventListener("change", () => { if (file.files[0]) importMarks(file.files[0], msg); file.value = ""; });
  const nodes = [
    h("p", { class: "modal-eyebrow", text: "MY DATA" }),
    h("h2", { id: "modalTitle", text: "保存データの管理" }),
    h("ul", { class: "counts" },
      h("li", null, h("span", { text: "あとで読む" }), h("b", { text: `${count("lt")} 件` })),
      h("li", null, h("span", { text: "既読" }), h("b", { text: `${count("rd")} 件` }))),
    h("p", { text: "「あとで読む」と「既読」は、このブラウザだけに保存しています。ほかの端末やブラウザには共有されません。機種変更やブラウザのデータ消去の前に、ファイルに書き出しておくと、あとで読み込めます。" }),
    h("div", { class: "panelbtns" }, exportBtn, importBtn), file, msg
  ];
  if (S.admin) {
    const off = h("button", { type: "button", class: "btn plain", text: "管理者モードをオフにする" });
    off.addEventListener("click", () => { setAdmin(false); closeModal(); });
    nodes.push(h("p", { class: "small-note", text: "この端末は管理者モードです。メニューに「運営管理」が出ています。" }), off);
  }
  openModal(nodes);
}

function exportMarks(msg) {
  const data = { app: "radwimps-interview-index", version: 3, exportedAt: new Date().toISOString(), bookmarks: [], later: Object.keys(S.marks.lt), read: Object.keys(S.marks.rd) };
  const d = new Date();
  const name = `radwimps-archive-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  msg.classList.remove("err");
  msg.textContent = `あとで読む ${data.later.length} 件・既読 ${data.read.length} 件をファイルに書き出しました。`;
}
async function importMarks(file, msg) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || data.app !== "radwimps-interview-index") throw new Error("not a backup");
    const ids = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.length < 160) : []);
    const add = (kind, list) => { let n = 0; for (const id of ids(list)) if (!S.marks[kind][id]) { S.marks[kind][id] = 1; n++; } return n; };
    const nl = add("lt", [...ids(data.later), ...ids(data.bookmarks)]), nr = add("rd", data.read); // 以前の「お気に入り」は、あとで読むへ
    saveMarks();
    render();
    msg.classList.remove("err");
    msg.textContent = `読み込みました（あとで読む ${nl} 件・既読 ${nr} 件を追加）。今ある記録はそのまま残ります。`;
  } catch {
    msg.classList.add("err");
    msg.textContent = "このファイルは読み込めませんでした。このサイトで書き出したバックアップファイルを選んでください。";
  }
}

function showAbout() {
  const nodes = [
    h("p", { class: "modal-eyebrow", text: "ABOUT" }),
    h("h2", { id: "modalTitle", text: "収録方針と出典について" }),
    ...$("#aboutText").content.cloneNode(true).children // 文章は index.html の <template id="aboutText"> にあります
  ];
  if (REPO) nodes.push(h("p", null, "記事の誤りやリンク切れに気づいたら、", h("a", { href: issueUrl("記事の誤り・リンク切れのお知らせ", "記事のタイトルか URL：\n\n気づいたこと：\n"), target: "_blank", rel: "noopener noreferrer", text: "こちらから知らせてください" }), "（GitHub のアカウントが必要です）。"));
  if (S.updated) nodes.push(h("p", { class: "small-note", text: `最終更新：${S.updated}` }));
  openModal(nodes);
}

function showAdd() {
  if (S.admin) { closeModal(); location.hash = "admin-add"; return; }
  const url = h("input", { id: "addUrl", type: "url", inputmode: "url", autocomplete: "off", placeholder: "https://" });
  const title = h("input", { id: "addTitle", type: "text", autocomplete: "off" });
  const note = h("textarea", { id: "addNote", rows: "3" });
  const send = h("a", { class: "btn primary", target: "_blank", rel: "noopener noreferrer", "aria-disabled": "true", text: "GitHub で送る" });
  const hint = h("p", { class: "hint" });
  const update = () => {
    const u = url.value.trim(), t = title.value.trim(), n = note.value.trim();
    send.removeAttribute("href");
    send.setAttribute("aria-disabled", "true");
    if (!REPO) { hint.textContent = "このページから送るには、サイトを GitHub Pages で公開している必要があります。"; return; }
    if (!/^https?:\/\/\S+$/i.test(u)) { hint.textContent = u ? "URL は https:// から始まる形で入れてください。" : "記事の URL を入れると、送れるようになります。送るには GitHub のアカウント（無料）が必要です。"; return; }
    send.href = issueUrl("記事の追加のお願い：" + (t || u), `記事の URL：${u}\nタイトル：${t || "（不明）"}\n\nひとこと：\n${n}\n`);
    send.removeAttribute("aria-disabled");
    hint.textContent = "押すと GitHub の画面が開きます。内容を確かめて「Submit new issue」を押すと送られます（GitHub のアカウントが必要です）。";
  };
  for (const el of [url, title, note]) el.addEventListener("input", update);
  send.addEventListener("click", (e) => { if (send.getAttribute("aria-disabled") === "true") e.preventDefault(); });
  const form = h("form", { class: "addform", novalidate: true },
    h("label", { for: "addUrl" }, "記事の URL（必須）", url),
    h("label", { for: "addTitle" }, "タイトル（わかれば）", title),
    h("label", { for: "addNote" }, "ひとこと（任意）", note),
    send, hint);
  form.addEventListener("submit", (e) => e.preventDefault());
  update();
  openModal([
    h("p", { class: "modal-eyebrow", text: "ADD AN ARTICLE" }),
    h("h2", { id: "modalTitle", text: "記事を追加する" }),
    h("p", { text: "この索引に載っていないインタビューやライブレポートを見つけたら、教えてください。運営が中身を確かめてから追加します。" }),
    form
  ]);
}

/* ---------- 運営管理（#admin） ---------- */

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
const issueUrl = (title, body) => `${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;

let adminEditor = null, adminLoading = false, adminOpenNew = false;
function renderAdmin() {
  $("#adminOffView").hidden = S.admin;
  $("#adminOnView").hidden = !S.admin;
  if (!S.admin) return;
  // 記事の管理（assets/admin.js）は、運営管理を開いたときだけ読み込む
  const wantNew = adminOpenNew;
  adminOpenNew = false;
  if (wantNew) history.replaceState(null, "", location.pathname + location.search + "#admin");
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
  const pub = S.items.length, vids = S.items.filter((it) => it.kind === VIDEO_KIND).length;
  const withSummary = S.items.filter((it) => it.summary).length;
  stats.replaceChildren(
    h("li", null, h("span", { text: "公開" }), h("b", { text: `${pub} 件` }), h("small", { text: `記事 ${pub - vids}・動画 ${vids}` })),
    h("li", null, h("span", { text: "非表示" }), h("b", { text: `${n("非表示")} 件` })),
    h("li", null, h("span", { text: "リンク切れ" }), h("b", { text: `${n("リンク切れ")} 件` })),
    h("li", null, h("span", { text: "説明あり" }), h("b", { text: `${withSummary} 件` }), h("small", { text: `公開中の記事のうち` })));
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

/* ---------- ボタン（data-act）の共通の受け口 ---------- */

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b || b.closest("#grid")) return;
  const act = b.dataset.act;
  if (act === "reset") { resetFilters(); render(); scrollToList(); }
  else if (act === "random") openRandom(e, b);
  else if (act === "backup") { setMenuOpen(false, { focusBack: false }); showBackup(); }
  else if (act === "about") showAbout();
  else if (act === "add") { setMenuOpen(false, { focusBack: false }); showAdd(); }
  else if (act === "admin-on") setAdmin(true);
  else if (act === "admin-off") setAdmin(false);
});

/* ---------- 通知 ---------- */

let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("#menuBtn").getAttribute("aria-expanded") === "true") setMenuOpen(false);
});

/* ---------- はじめに ---------- */

function onHash() {
  const r = readHash();
  S.page = r.page;
  if (r.openNew) adminOpenNew = true;
  if (r.clear) history.replaceState(null, "", location.pathname + location.search);
  render();
  if (r.page === "admin") { window.scrollTo(0, 0); $("#adminTitle").focus({ preventScroll: true }); }
  if (r.dialog === "add") { history.replaceState(null, "", location.pathname + location.search); showAdd(); }
  if (r.dialog === "backup") { history.replaceState(null, "", location.pathname + location.search); showBackup(); }
}
window.addEventListener("hashchange", () => { if (location.hash !== "#archive") onHash(); });

if (REPO) {
  $("#report").href = issueUrl("記事の誤り・リンク切れのお知らせ", "記事のタイトルか URL：\n\n気づいたこと：\n");
  $("#report").hidden = false;
}
saveMarks(); // 以前の「お気に入り」を「あとで読む」にまとめた結果を保存
readURL();
S.lastEntry = entryOfState();
syncFilterPanel();
onHash();
loadData();
