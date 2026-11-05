// assets/data.js
// 記事データ（CSV ファイル）を読み込んで、サイトで使える形に整えるプログラムです。
// サイト（ブラウザ）と、チェック用のスクリプト（tools フォルダ）の両方から使います。
// 列の名前や書ける値を増やしたいときは、このファイルの「決まった値」を書き換えます。

/* ---------- 決まった値 ---------- */

// 「種類」列に書ける値。この順番で絞り込みに並びます。
// ここにない種類を書いた場合も表示はされ、絞り込みの最後に並びます（チェックでは「注意」が出ます）。
// 「ライブレポート」は、ライブやイベントの様子を伝える記事です（対バンのゲストは「対談相手」の列に書きます）。
// 「ほかの人が語る」は、メンバー以外の人（共演者・スタッフ・ほかのアーティストなど）が RADWIMPS について語る記事です。
export const KIND_ORDER = ["インタビュー", "対談・鼎談", "特集・企画", "雑誌・ムック", "動画", "番組・会見", "ライブレポート", "解説・メッセージ", "ほかの人が語る"];

// 種類が「動画」の記事は、サイトの「動画」のページに表示します。それ以外は「記事」のページです。
export const VIDEO_KIND = "動画";
export const categoryOf = (kind) => (kind === VIDEO_KIND ? "video" : "article");

// リンクを押すとアプリやストアが開き、インタビューの中身が読めないことが多いサイト。
// 公開する記事にこれらの URL を書くと、チェックで「注意」が出ます。
const APP_OR_STORE_HOSTS = [
  "music.apple.com", "itunes.apple.com", "apps.apple.com", "podcasts.apple.com",
  "open.spotify.com", "spotify.link", "music.amazon.co.jp", "music.amazon.com",
  "amazon.co.jp", "www.amazon.co.jp", "amazon.com", "www.amazon.com",
  "play.google.com", "line.me", "fujisan.co.jp", "www.fujisan.co.jp"
];

// 有料会員限定のコンテンツ（ファンクラブ「ボクンチ」など）は載せません。
// 公開する記事にこれらの URL を書くと、チェックで「エラー」になり、サイトの更新が止まります。
const PAID_MEMBERS_HOSTS = ["bokunchi.radwimps.jp"];

// 「種類」の短い書き方も受け付けます（左の書き方 → 右の種類として扱う）。
const KIND_ALIASES = {
  "対談": "対談・鼎談", "鼎談": "対談・鼎談", "特集": "特集・企画", "企画": "特集・企画",
  "雑誌": "雑誌・ムック", "ムック": "雑誌・ムック", "番組": "番組・会見", "会見": "番組・会見",
  "ラジオ": "番組・会見", "テレビ": "番組・会見", "解説": "解説・メッセージ", "メッセージ": "解説・メッセージ",
  "ライブ": "ライブレポート", "ライヴ": "ライブレポート", "ライブレポ": "ライブレポート", "ライヴレポート": "ライブレポート",
  "ライブ・レポート": "ライブレポート", "レポート": "ライブレポート", "公演レポート": "ライブレポート",
  "関係者": "ほかの人が語る"
};

// 「メンバー」列に書ける名前。aliases にある書き方なら、どれでも同じ人として扱います。
// romaji と kana は検索用です（「noda」や「のだ」で探せるようにするため）。
export const MEMBERS = {
  noda:      { name: "野田洋次郎", aliases: ["野田洋次郎", "野田", "洋次郎"], romaji: "yojiro noda", kana: "のだ ようじろう" },
  takeda:    { name: "武田祐介", aliases: ["武田祐介", "武田"], romaji: "yusuke takeda", kana: "たけだ ゆうすけ" },
  yamaguchi: { name: "山口智史", aliases: ["山口智史", "山口"], romaji: "satoshi yamaguchi", kana: "やまぐち さとし" },
  kuwahara:  { name: "桑原彰", aliases: ["桑原彰", "桑原"], romaji: "akira kuwahara", kana: "くわはら あきら" },
  band:      { name: "RADWIMPS", aliases: ["RADWIMPS", "ラッドウィンプス", "バンド", "全員"], romaji: "radwimps", kana: "らっどうぃんぷす", filterLabel: "バンド名義" }
};
export const MEMBER_ORDER = ["noda", "takeda", "yamaguchi", "kuwahara", "band"];

// 「カテゴリ」列に書ける値（記事が生まれたきっかけ）。この順番でメニューに並びます。
// 1つの記事に、「、」で区切っていくつでも書けます（例：ライブ・ツアー、周年・節目）。
// slug は URL の末尾に付く名前（例：#c-tieup）です。半角の英小文字とハイフンだけで書き、一度決めたら変えないでください。
// desc は、そのカテゴリを開いたときに見出しの下に出る短い説明です。
export const CATEGORIES = [
  { name: "新作リリース", slug: "release", desc: "アルバムやシングルの発売に合わせた記事", aliases: ["リリース", "新作"] },
  { name: "タイアップ", slug: "tieup", desc: "映画・ドラマ・CM などの主題歌や音楽から生まれた記事", aliases: [] },
  { name: "ライブ・ツアー", slug: "live", desc: "ライブレポートと、ツアーにまつわる記事", aliases: ["ライブ", "ツアー"] },
  { name: "周年・節目", slug: "anniversary", desc: "デビュー10周年・20周年など、節目の記事", aliases: ["周年", "節目"] },
  { name: "コラボ・楽曲提供", slug: "collab", desc: "ほかのアーティストとの共作や、楽曲提供の記事", aliases: ["コラボ", "楽曲提供", "共作"] },
  { name: "俳優・出演", slug: "acting", desc: "映画やドラマへの出演にまつわる記事", aliases: ["俳優", "出演"] },
  { name: "楽器・ファッション", slug: "gear", desc: "楽器や機材、ファッションの記事", aliases: ["楽器", "機材", "ファッション"] },
  { name: "本・ドキュメンタリー", slug: "books", desc: "本の出版や、ドキュメンタリー映画の記事", aliases: ["本", "書籍", "ドキュメンタリー"] },
  { name: "人物・素顔", slug: "people", desc: "メンバーの歩みや考え方、素顔にふれる記事", aliases: ["人物", "素顔"] }
];
const CATEGORY_BY_NAME = new Map();
for (const c of CATEGORIES) for (const n of [c.name, ...c.aliases]) CATEGORY_BY_NAME.set(n, c.name);

// 「言語」列に書ける値。空欄なら日本語として扱います。
export const LANGS = { "日本語": "ja", "英語": "en", "スペイン語": "es", "その他": "other" };
export const LANG_BADGE = { en: "EN", es: "ES", other: "他" };
export const LANG_NAME = { ja: "日本語の記事", en: "英語の記事", es: "スペイン語の記事", other: "日本語以外の記事" };

// 「状態」列に書ける値。「公開」（または空欄）の記事だけをサイトに表示します。
export const STATES = ["公開", "非表示", "リンク切れ"];

// articles.csv の列の名前（1行目に書く見出し）と、プログラムの中での呼び名
const ARTICLE_COLUMNS = {
  "状態": "state", "年": "y", "月": "m", "日": "d", "媒体": "media", "種類": "kind", "カテゴリ": "categories", "タイトル": "title",
  "URL": "url", "メンバー": "members", "対談相手": "guests", "タグ": "tags", "言語": "lang", "メモ": "note", "id": "id", "ID": "id"
};
const ARTICLE_REQUIRED = ["媒体", "タイトル", "URL"];

const RELEASE_COLUMNS = { "年": "y", "月": "m", "日": "d", "作品名": "name" };
const RELEASE_REQUIRED = ["年", "作品名"];

/* ---------- CSV の読み取り ---------- */

// CSV の文字列を行と列に分けます。"..." で囲んだ項目の中のカンマ・改行・"" にも対応します。
// lines には、各行が CSV ファイルの何行目から始まるかが入ります（エラーの行番号表示に使います）。
export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // Excel が付ける BOM を外す
  const rows = [], lines = [];
  let row = [], field = "", quoted = false, line = 1, rowLine = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else if (c === "\r" && text[i + 1] === "\n") {
        // CRLF の CR は読み飛ばす
      } else {
        if (c === "\n") line++;
        field += c;
      }
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r") { /* 改行の CR は読み飛ばす */ }
    else if (c === "\n") {
      row.push(field); rows.push(row); lines.push(rowLine);
      row = []; field = ""; line++; rowLine = line;
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); lines.push(rowLine); }
  return { rows, lines, unclosedQuote: quoted, lastLine: line };
}

// 1行目（見出し）から、列の位置を調べます。
function readHeader(rows, columns, required, errors, warnings) {
  const index = {};
  const header = (rows[0] || []).map((h) => h.replace(/^﻿/, "").trim());
  header.forEach((h, i) => {
    const key = columns[h];
    if (key) { if (index[key] === undefined) index[key] = i; }
    else if (h) warnings.push({ line: 1, msg: `「${h}」という列は使われていません` });
  });
  for (const name of required) {
    if (index[columns[name]] === undefined) errors.push({ line: 1, msg: `1行目（見出し）に「${name}」の列がありません` });
  }
  return index;
}

/* ---------- 小さな道具 ---------- */

const nfkc = (s) => String(s ?? "").normalize("NFKC").trim();
const pad2 = (n) => String(Number(n)).padStart(2, "0");

function validDay(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return d >= 1 && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function splitList(s, re) {
  return String(s ?? "").split(re).map((x) => x.trim()).filter(Boolean);
}

function memberKey(name) {
  const n = nfkc(name).replace(/\s+/g, "").toLowerCase();
  for (const key of MEMBER_ORDER) {
    if (MEMBERS[key].aliases.some((a) => nfkc(a).replace(/\s+/g, "").toLowerCase() === n)) return key;
  }
  return null;
}

// YouTube の動画の URL なら、動画の id を返します（それ以外は null）。
export function youtubeId(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^(www|m)\./, "");
  if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
  if (host === "youtube.com" || host === "music.youtube.com") {
    if (u.pathname === "/watch") return u.searchParams.get("v");
    const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/);
    return m ? m[1] : null;
  }
  return null;
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

// URL から、いつも同じになる短い id を作ります（id 列が空欄のとき用）。
export function idFromUrl(url) {
  let h = 0x811c9dc5;
  for (const ch of String(url)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return "u-" + h.toString(36);
}

// 年・月・日の列から「2026-11-04」「2026-11」「2026」の形を作ります。問題があれば err に書きます。
function readDate(ys, ms, ds, line, err) {
  ys = nfkc(ys); ms = nfkc(ms); ds = nfkc(ds);
  if (!ys) {
    if (ms || ds) err(line, "月や日を書くときは、年も書いてください");
    return "";
  }
  if (!/^\d{4}$/.test(ys) || +ys < 1990 || +ys > 2100) { err(line, `年「${ys}」は4桁の西暦で書いてください（例：2026）`); return ""; }
  if (!ms) {
    if (ds) err(line, "日を書くときは、月も書いてください");
    return ys;
  }
  if (!/^\d{1,2}$/.test(ms) || +ms < 1 || +ms > 12) { err(line, `月「${ms}」は1〜12の数字で書いてください`); return ""; }
  if (!ds) return `${ys}-${pad2(ms)}`;
  if (!/^\d{1,2}$/.test(ds) || !validDay(+ys, +ms, +ds)) { err(line, `日「${ds}」は、${ys}年${+ms}月にない日付です`); return ""; }
  return `${ys}-${pad2(ms)}-${pad2(ds)}`;
}

/* ---------- 記事データ（articles.csv） ---------- */

// 戻り値：{ items: 記事の一覧, errors: 直す必要がある問題, warnings: 気をつけたい点 }
// errors がある行は items に入りません（その行だけ表示されなくなります）。
export function parseArticles(text) {
  const items = [], errors = [], warnings = [];
  const err = (line, msg) => errors.push({ line, msg });
  const warn = (line, msg) => warnings.push({ line, msg });

  const { rows, lines, unclosedQuote, lastLine } = parseCSV(text);
  if (unclosedQuote) err(lastLine, "「\"」で始めた項目が閉じられていません。\" の数を確かめてください");
  if (!rows.length || rows.every((r) => r.every((c) => !c.trim()))) {
    err(1, "ファイルが空です");
    return { items, errors, warnings };
  }
  const col = readHeader(rows, ARTICLE_COLUMNS, ARTICLE_REQUIRED, errors, warnings);
  if (errors.length) return { items, errors, warnings };

  const seenIds = new Map(), seenUrls = new Map();
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r], line = lines[r];
    if (cells.every((c) => !c.trim())) continue; // 空行は無視
    const get = (key) => (col[key] === undefined ? "" : String(cells[col[key]] ?? "").trim());
    const before = errors.length;

    const state = nfkc(get("state")) || "公開";
    if (!STATES.includes(state)) err(line, `状態「${state}」は使えません（${STATES.join("・")} のどれかを書きます）`);

    const date = readDate(get("y"), get("m"), get("d"), line, err);

    const media = get("media"), title = get("title"), url = get("url");
    if (!media) err(line, "媒体が空欄です");
    if (!title) err(line, "タイトルが空欄です");
    if (!url) err(line, "URL が空欄です");
    else if (!/^https?:\/\/\S+$/i.test(url)) err(line, "URL は http:// か https:// で始め、途中に空白を入れないでください");

    let kind = nfkc(get("kind")) || "インタビュー";
    kind = KIND_ALIASES[kind] || kind;
    if (!KIND_ORDER.includes(kind)) warn(line, `種類「${kind}」は決まった値にないため、新しい種類として表示されます`);

    const members = [];
    for (const name of splitList(get("members"), /[、,，・/／]/)) {
      const key = memberKey(name);
      if (!key) err(line, `メンバー「${name}」が分かりません（${MEMBER_ORDER.map((k) => MEMBERS[k].name).join("・")} のどれかを書きます）`);
      else if (!members.includes(key)) members.push(key);
    }

    const guests = splitList(get("guests"), /[、,，]/);

    // カテゴリ（「・」は名前の一部なので、区切りは「、」かカンマだけ）
    const categories = [];
    for (const name of splitList(get("categories"), /[、,，]/)) {
      const c = CATEGORY_BY_NAME.get(nfkc(name)) || nfkc(name);
      if (!CATEGORY_BY_NAME.has(c)) warn(line, `カテゴリ「${c}」は決まった値にないため、新しいカテゴリとしてメニューの最後に出ます（${CATEGORIES.map((x) => x.name).join("・")}）`);
      if (!categories.includes(c)) categories.push(c);
    }
    if (col.categories !== undefined && !categories.length && state === "公開" && kind !== VIDEO_KIND) {
      warn(line, "カテゴリが空欄です。メニューのカテゴリには出ません（「すべての記事」には出ます）");
    }

    const tagCell = get("tags");
    let tags;
    if (/[#＃]/.test(tagCell)) tags = splitList(tagCell, /[#＃]/);
    else {
      tags = splitList(tagCell, /[、,，]/);
      if (tags.length) warn(line, "タグは「#あにゅー #20周年」のように、1つずつ # を付けて書いてください（「、」で区切ると「汝、星のごとく」のような作品名が分かれてしまいます）");
    }

    const langLabel = nfkc(get("lang")) || "日本語";
    let lang = LANGS[langLabel];
    if (!lang) { warn(line, `言語「${langLabel}」は「その他」として扱います（${Object.keys(LANGS).join("・")}）`); lang = "other"; }

    let id = get("id");
    if (id && !/^[A-Za-z0-9_-]{1,80}$/.test(id)) err(line, "id は半角の英数字・ハイフン（-）・アンダーバー（_）だけで書いてください");
    if (!id && url) id = idFromUrl(url);
    if (id && seenIds.has(id)) err(line, `id「${id}」が ${seenIds.get(id)} 行目と同じです。id は記事ごとに別のものにしてください`);
    else if (id) seenIds.set(id, line);

    if (url && seenUrls.has(url)) warn(line, `同じ URL が ${seenUrls.get(url)} 行目にもあります`);
    else if (url) seenUrls.set(url, line);

    // 公開する記事だけ、リンク先の種類を確かめる
    if (state === "公開" && url) {
      if (PAID_MEMBERS_HOSTS.includes(hostOf(url))) err(line, "ファンクラブ（ボクンチ）など、有料会員限定のページは載せません。状態を「非表示」にするか、行を消してください");
      if (APP_OR_STORE_HOSTS.includes(hostOf(url))) warn(line, "この URL はアプリやストアのページで、押してもインタビューの中身が読めないことがあります。記事が読めるページがなければ、状態を「非表示」にしてください");
      if (youtubeId(url) && kind !== VIDEO_KIND) warn(line, `YouTube の URL です。「動画」のページに出すには、種類を「${VIDEO_KIND}」にしてください`);
    }

    if (errors.length > before) continue;
    items.push({ id, state, date, media, kind, cat: categoryOf(kind), categories, title, url, members, guests, tags, lang, note: get("note"), line });
  }
  return { items, errors, warnings };
}

/* ---------- 年ごとのリリース（releases.csv） ---------- */

// 戻り値：{ byYear: { "2026": [{ name, label }] }, errors, warnings }
export function parseReleases(text) {
  const byYear = {}, errors = [], warnings = [];
  const err = (line, msg) => errors.push({ line, msg });
  const { rows, lines, unclosedQuote, lastLine } = parseCSV(text);
  if (unclosedQuote) err(lastLine, "「\"」で始めた項目が閉じられていません");
  if (!rows.length) return { byYear, errors, warnings };
  const col = readHeader(rows, RELEASE_COLUMNS, RELEASE_REQUIRED, errors, warnings);
  if (errors.length) return { byYear, errors, warnings };
  const list = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r], line = lines[r];
    if (cells.every((c) => !c.trim())) continue;
    const get = (key) => (col[key] === undefined ? "" : String(cells[col[key]] ?? "").trim());
    const before = errors.length;
    const name = get("name");
    if (!name) err(line, "作品名が空欄です");
    const date = get("y") ? readDate(get("y"), get("m"), get("d"), line, err) : "";
    if (!get("y")) err(line, "年が空欄です");
    if (errors.length > before) continue;
    const [y, m, d] = date.split("-");
    list.push({ y, m: m ? +m : 13, d: d ? +d : 32, name, label: m && d ? `${m}.${d}` : m ? `${+m}月` : "" });
  }
  list.sort((a, b) => a.m - b.m || a.d - b.d);
  for (const it of list) (byYear[it.y] = byYear[it.y] || []).push({ name: it.name, label: it.label });
  return { byYear, errors, warnings };
}

/* ---------- CSV の1行を作る（記事データ作成ツール用） ---------- */

export const ARTICLE_HEADER = ["状態", "年", "月", "日", "媒体", "種類", "カテゴリ", "タイトル", "URL", "メンバー", "対談相手", "タグ", "言語", "メモ", "id"];

export function toCSVLine(cells) {
  return cells.map((v) => {
    v = String(v ?? "");
    return /[",\n\r]|^\s|\s$/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }).join(",");
}
