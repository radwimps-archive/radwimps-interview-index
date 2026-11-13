// assets/data.js
// 記事データ（CSV ファイル）を読み込んで、サイトで使える形に整えるプログラムです。
// サイト（ブラウザ）と、チェック用のスクリプト（tools フォルダ）の両方から使います。
// 列の名前や書ける値を増やしたいときは、このファイルの「決まった値」を書き換えます。

/* ---------- 決まった値 ---------- */

// 「種類」列に書ける値。この順番で絞り込みに並びます。
// ここにない種類を書いた場合も表示はされ、絞り込みの最後に並びます（チェックでは「注意」が出ます）。
// 「ライブレポート」は、ライブやイベントの様子を伝える記事です（対バンのゲストは「対談相手」の列に書きます）。
// 「ほかの人が語る」は、メンバー以外の人（共演者・スタッフ・ほかのアーティストなど）が RADWIMPS について語る記事です。
// 「リリース情報」は、発売・公開のお知らせや、雑誌の掲載号の案内など、インタビュー本文ではない資料です。
// 「ラジオ」は、ラジオ番組の放送そのもの（YouTube などで公式に配信されている放送回）です。
// 放送の内容を文字でまとめたページ（オンエアレポートなど）は「番組・会見」にします。
export const KIND_ORDER = ["インタビュー", "対談・鼎談", "特集・企画", "雑誌・ムック", "動画", "ラジオ", "番組・会見", "ライブレポート", "解説・メッセージ", "ほかの人が語る", "リリース情報"];

// 種類が「動画」の記事は「動画インタビュー」のタブに、「ラジオ」は「ラジオ」のタブに、
// 「リリース情報」は「リリース情報」のタブに表示します（「すべて」のタブには全部出ます）。
// それ以外は「記事・資料」のタブです。
export const VIDEO_KIND = "動画";
export const RADIO_KIND = "ラジオ";
export const RELEASE_KIND = "リリース情報";
export const LIVE_KIND = "ライブレポート";
// 何も書かなかったときの種類と、メンバー以外の人が語る記事の種類（画面の表示を分けるのに使います）
export const INTERVIEW_KIND = "インタビュー";
export const OTHERS_KIND = "ほかの人が語る";
export const formatOf = (kind) => (kind === VIDEO_KIND ? "video" : kind === RADIO_KIND ? "radio" : kind === RELEASE_KIND ? "release" : "text");

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
  "テレビ": "番組・会見", "解説": "解説・メッセージ", "メッセージ": "解説・メッセージ",
  "ライブ": "ライブレポート", "ライヴ": "ライブレポート", "ライブレポ": "ライブレポート", "ライヴレポート": "ライブレポート",
  "ライブ・レポート": "ライブレポート", "レポート": "ライブレポート", "公演レポート": "ライブレポート",
  "関係者": "ほかの人が語る", "お知らせ": "リリース情報", "発売情報": "リリース情報", "掲載情報": "リリース情報"
};

// 「メンバー」列に書ける名前。aliases にある書き方なら、どれでも同じ人として扱います。
// romaji と kana は検索用です（「noda」や「のだ」で探せるようにするため）。
// group は「人から探す」での分け方です（member：メンバー、former：脱退したメンバー、band：バンド名義）。
export const MEMBERS = {
  noda:      { name: "野田洋次郎", aliases: ["野田洋次郎", "野田", "洋次郎"], romaji: "yojiro noda", kana: "のだ ようじろう", group: "member" },
  takeda:    { name: "武田祐介", aliases: ["武田祐介", "武田"], romaji: "yusuke takeda", kana: "たけだ ゆうすけ", group: "member" },
  yamaguchi: { name: "山口智史", aliases: ["山口智史", "山口"], romaji: "satoshi yamaguchi", kana: "やまぐち さとし", group: "member" },
  kuwahara:  { name: "桑原彰", aliases: ["桑原彰", "桑原"], romaji: "akira kuwahara", kana: "くわはら あきら", group: "former" }, // 2024年10月に脱退
  band:      { name: "RADWIMPS", aliases: ["RADWIMPS", "ラッドウィンプス", "バンド", "全員"], romaji: "radwimps", kana: "らっどうぃんぷす", filterLabel: "バンド名義", group: "band" }
};
export const MEMBER_ORDER = ["noda", "takeda", "yamaguchi", "kuwahara", "band"];

// 「人から探す」で「サポートメンバー」として並べる人。記事には「対談相手」の列に名前を書きます。
export const SUPPORT_MEMBERS = ["森瑞希", "エノマサフミ", "白川詢"];

// 「曲・作品から探す」に並べる作品。group ごとにまとめて表示します。
// 記事のタイトル・説明・タグに作品名（または aliases のどれか）が入っていると、その作品の記事として見つかります。
// 記事が1つもない作品は、自動で表示しません。新しい作品は、この一覧に足してください。
export const WORKS = [
  ...["君の名は。", "天気の子", "すずめの戸締まり", "余命10年", "汝、星のごとく", "パレード", "キネマの神様", "わたくしどもは。", "トイレのピエタ"].map((name) => ({ group: "映画", name })),
  ...["あんぱん", "フランケンシュタインの恋", "100万円の女たち", "人間ごっこ", "猫じゃらし"].map((name) => ({ group: "ドラマ・CM", name })),
  ...["RADWIMPS 2", "RADWIMPS 3", "RADWIMPS 4", "アルトコロニーの定理", "絶体絶命", "×と○と罪と", "人間開花", "ANTI ANTI GENERATION",
    "FOREVER DAZE", "あにゅー", "WONDER BOY’S AKUMU CLUB", "UBU", "P.Y.L", "ME SO SHE LOOSE", "僕だけの愛", "1R＋1"].map((name) => ({ group: "アルバム・EP", name })),
  ...["携帯電話", "有心論", "君と羊と青", "そっけない", "夏のせい", "うるうびと", "筆舌", "夕星", "すずめ", "カナタハルカ", "前前前世", "スパークル",
    "なんでもないや", "夢灯籠", "愛にできることはまだあるかい", "グランドエスケープ", "大丈夫", "祝祭", "正解", "賜物", "命題", "ピアフ", "記号として",
    "ふたりごと", "オーダーメイド", "おしゃかしゃま", "DADA", "狭心症", "五月の蝿", "ラストバージン", "会心の一撃", "実況中継", "なんちって", "遠恋", "光",
    "棒人間", "サイハテアイニ", "洗脳", "Mountain Top", "カタルシスト", "PAPARAZZI", "泣き出しそうだよ", "鋼の羽根", "うたかた歌", "大団円",
    "KANASHIBARI", "Light The Light", "ココロノナカ", "新世界", "ラリルレ論", "フラレガイガール"].map((name) => ({ group: "曲", name }))
];
// 「曲・作品から探す」を開いたときに、すぐ押せるように出しておく作品
export const QUICK_WORKS = ["すずめの戸締まり", "携帯電話", "そっけない", "あにゅー"];

// 「カテゴリ」列に書ける値（記事が生まれたきっかけ）。この順番で「さらに絞り込む」の「内容から選ぶ」に並びます。
// 1つの記事に、「、」で区切っていくつでも書けます（例：ライブ・ツアー、周年・節目）。
// slug は以前の URL（例：#c-tieup）でそのカテゴリを開くための名前です。半角の英小文字とハイフンだけで書き、一度決めたら変えないでください。
// desc は、そのカテゴリで絞り込んだときに、一覧の見出しの下に出る短い説明です。
export const CATEGORIES = [
  { name: "新作リリース", slug: "release", desc: "アルバムやシングルの発売に合わせた記事", aliases: ["リリース", "新作"] },
  { name: "タイアップ", slug: "tieup", desc: "映画・ドラマ・CM などの主題歌や音楽から生まれた記事", aliases: [] },
  { name: "ライブ・ツアー", slug: "live", desc: "ライブレポートと、ツアーにまつわる記事", aliases: ["ライブ", "ツアー"] },
  { name: "周年・節目", slug: "anniversary", desc: "デビュー10周年・20周年など、節目の記事", aliases: ["周年", "節目"] },
  { name: "コラボ・楽曲提供", slug: "collab", desc: "ほかのアーティストとの共作や、楽曲提供の記事", aliases: ["コラボ", "楽曲提供", "共作"] },
  { name: "俳優・出演", slug: "acting", desc: "映画やドラマへの出演にまつわる記事", aliases: ["俳優", "出演"] },
  { name: "楽器・ファッション", slug: "gear", desc: "楽器や機材、ファッションの記事", aliases: ["楽器", "機材", "ファッション"] },
  { name: "本・ドキュメンタリー", slug: "books", desc: "本の出版や、ドキュメンタリー映画の記事", aliases: ["本", "書籍", "ドキュメンタリー"] },
  { name: "人物・素顔", slug: "people", desc: "メンバーの歩みや考え方、素顔にふれる記事", aliases: ["人物", "素顔"] },
  { name: "ソロ・別プロジェクト", slug: "side", desc: "野田洋次郎のソロ（illion など）や、糸色-itoshiki-・味噌汁’s など、RADWIMPS 以外の活動の記事", aliases: ["ソロ", "別プロジェクト", "illion"] }
];
const CATEGORY_BY_NAME = new Map();
for (const c of CATEGORIES) for (const n of [c.name, ...c.aliases]) CATEGORY_BY_NAME.set(n, c.name);

// 「言語」列に書ける値。空欄なら日本語として扱います。
export const LANGS = { "日本語": "ja", "英語": "en", "スペイン語": "es", "その他": "other" };
export const LANG_BADGE = { en: "EN", es: "ES", other: "他" };

// 「状態」列に書ける値。「公開」（または空欄）の記事だけをサイトに表示します。
export const STATES = ["公開", "非表示", "リンク切れ"];

// articles.csv の列の名前（1行目に書く見出し）と、プログラムの中での呼び名
const ARTICLE_COLUMNS = {
  "状態": "state", "年": "y", "月": "m", "日": "d", "媒体": "media", "種類": "kind", "カテゴリ": "categories", "タイトル": "title",
  "URL": "url", "メンバー": "members", "対談相手": "guests", "タグ": "tags", "言語": "lang", "メモ": "note",
  "説明": "summary", "公演日": "eventDate", "ライブ名": "eventName", "会場": "venue", "id": "id", "ID": "id"
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

// YouTube の動画の URL なら、動画の id（11文字）を返します（それ以外は null）。
// 受け付ける URL：youtube.com/watch?v=…、youtu.be/…、youtube.com/shorts/…・/embed/…・/live/…（www.・m.・music.・youtube-nocookie.com も）
// { allowId: true } のときは、「XRnX65LDRoU」のような id だけの書き方も受け付けます（年表の「動画」の列）。
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
export function youtubeId(value, { allowId = false } = {}) {
  const s = String(value ?? "").trim();
  if (allowId && YOUTUBE_ID.test(s)) return s;
  let u;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  let id = null;
  if (host === "youtu.be") id = u.pathname.split("/")[1];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = u.pathname === "/watch" ? u.searchParams.get("v") : (u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/) || [])[1];
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
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

// 「公演日」の列（1つのセルに「2013-09-15」「2013/9/15」「2013.9.15」「2013-09」「2013」のどれかで書く）を読みます。
function readDateCell(s, line, err) {
  s = nfkc(s);
  if (!s) return "";
  const m = s.match(/^(\d{4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?$/);
  if (!m) { err(line, `公演日「${s}」は「2013-09-15」のように、年-月-日で書いてください`); return ""; }
  return readDate(m[1], m[2] || "", m[3] || "", line, (l, msg) => err(l, "公演日：" + msg));
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

    let kind = nfkc(get("kind")) || INTERVIEW_KIND;
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
      if (!CATEGORY_BY_NAME.has(c)) warn(line, `カテゴリ「${c}」は決まった値にないため、新しいカテゴリとして「内容から選ぶ」の最後に出ます（${CATEGORIES.map((x) => x.name).join("・")}）`);
      if (!categories.includes(c)) categories.push(c);
    }
    if (col.categories !== undefined && !categories.length && state === "公開" && kind !== VIDEO_KIND) {
      warn(line, "カテゴリが空欄です。「内容から選ぶ」で絞り込んだときには出ません（すべての記事には出ます）");
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
      if (APP_OR_STORE_HOSTS.includes(hostOf(url)) && kind !== RELEASE_KIND) warn(line, "この URL はアプリやストアのページで、押してもインタビューの中身が読めないことがあります。記事が読めるページがなければ、状態を「非表示」にしてください");
      if (youtubeId(url) && kind !== VIDEO_KIND && kind !== RADIO_KIND) warn(line, `YouTube の URL です。「動画インタビュー」のタブに出すには、種類を「${VIDEO_KIND}」にしてください（ラジオの放送回なら「${RADIO_KIND}」）`);
    }

    // ライブの情報（ライブレポートのとき。公演日ごとに記事をまとめて表示します）
    const eventDate = readDateCell(get("eventDate"), line, err);
    const eventName = get("eventName"), venue = get("venue");
    if ((eventName || venue) && !eventDate) warn(line, "ライブ名や会場を書いたときは、公演日も書いてください（公演日ごとにまとめて表示するため）");

    if (errors.length > before) continue;
    items.push({ id, state, date, media, kind, format: formatOf(kind), categories, title, url, members, guests, tags, lang,
      note: get("note"), summary: get("summary"), eventDate, eventName, venue, line });
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

/* ---------- 年表（history.csv） ---------- */

// 年表のカテゴリ：CSV に書く名前、URL の末尾（#…）、スマホのタブに出す短い名前
// 1つの出来事を2つ以上のカテゴリに入れるときは、CSV に「バンドの出来事、山口智史・VXD」のように「、」で区切って書きます（最初のものが主なカテゴリ）
export const HISTORY_CATEGORIES = [
  { name: "リリース", slug: "release", short: "リリース" },
  { name: "ライブ・ツアー", slug: "live", short: "ライブ" },
  { name: "映画・タイアップ", slug: "tieup", short: "タイアップ" },
  { name: "バンドの出来事", slug: "band", short: "出来事" },
  // メンバーそれぞれの活動（MV のタブでも、このカテゴリの印を残す）
  { name: "野田洋次郎・ソロ", slug: "solo", short: "ソロ", person: true },
  { name: "山口智史・VXD", slug: "vxd", short: "VXD", person: true }
];
// カテゴリが空欄のときに入れるカテゴリ
const HISTORY_DEFAULT_CATEGORY = HISTORY_CATEGORIES.find((c) => c.slug === "band");

const HISTORY_COLUMNS = {
  "年": "y", "月": "m", "日": "d", "終了年": "ey", "終了月": "em", "終了日": "ed", "カテゴリ": "cat", "出来事": "title", "補足": "note",
  "特設サイト": "site", "タワーレコード": "tower", "動画": "video"
};
const HISTORY_REQUIRED = ["年", "カテゴリ", "出来事"];

// 「動画」の列（「ラベル=動画の ID か URL」を「 | 」で区切って並べる。ラベルを省くと「MV」）を読みます。
// 戻り値：{ videos: [{ label, id }], bad: 読めなかった部分の一覧 }
export function parseVideos(value) {
  const videos = [], bad = [];
  for (const part of String(value ?? "").split("|").map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^(?:(.*?)\s*=\s*)?(https:\/\/\S+|[A-Za-z0-9_-]{11})$/);
    const id = m ? youtubeId(m[2], { allowId: true }) : null;
    if (id) videos.push({ label: (m[1] || "").trim() || "MV", id });
    else bad.push(part);
  }
  return { videos, bad };
}

// 戻り値：{ events: 出来事の一覧（古い順）, errors: 直す必要がある問題, warnings: 気をつけたい点 }
// 年か出来事が書けていない行は events に入りません。カテゴリの書き間違いは、チェックでエラーになります
// （サイトでは、正しく書けたカテゴリだけで表示し、1つもなければ「バンドの出来事」に入れます）。
export function parseHistory(text) {
  const events = [], errors = [], warnings = [];
  const err = (line, msg) => errors.push({ line, msg });
  const warn = (line, msg) => warnings.push({ line, msg });
  const { rows, lines, unclosedQuote, lastLine } = parseCSV(text);
  if (unclosedQuote) err(lastLine, "「\"」で始めた項目が閉じられていません。\" の数を確かめてください");
  if (!rows.length || rows.every((r) => r.every((c) => !c.trim()))) { err(1, "ファイルが空です"); return { events, errors, warnings }; }
  const col = readHeader(rows, HISTORY_COLUMNS, HISTORY_REQUIRED, errors, warnings);
  if (errors.length) return { events, errors, warnings };
  const names = HISTORY_CATEGORIES.map((c) => c.name).join("・");

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r], line = lines[r];
    if (cells.every((c) => !c.trim())) continue; // 空行は無視
    const get = (key) => (col[key] === undefined ? "" : String(cells[col[key]] ?? "").trim());
    const before = errors.length;

    const title = get("title");
    if (!title) err(line, "出来事が空欄です");
    if (!get("y")) err(line, "年が空欄です");
    const start = get("y") ? readDate(get("y"), get("m"), get("d"), line, err) : "";
    const end = readDate(get("ey"), get("em"), get("ed"), line, err);
    if (start && end && end < start) warn(line, "終わりの日付が、始まりの日付より前になっています");

    // カテゴリ（「、」で区切って2つ以上書ける）
    const cats = [];
    for (const n of get("cat").split(/[、,]/).map((x) => nfkc(x).trim()).filter(Boolean)) {
      const c = HISTORY_CATEGORIES.find((k) => k.name === n);
      if (!c) err(line, `カテゴリ「${n}」は使えません。${names} のどれかを書いてください（2つ以上は「、」で区切ります）`);
      else if (!cats.includes(c)) cats.push(c);
    }
    if (!get("cat")) warn(line, `カテゴリが空欄です（「${HISTORY_DEFAULT_CATEGORY.name}」として表示します）`);

    // リンク
    let site = get("site");
    if (site && !/^https:\/\/[^\s"<>]+$/.test(site)) { warn(line, "特設サイトの URL は https:// で始まるものだけ使えます（このリンクは出ません）"); site = ""; }
    const tower = get("tower");
    if (/^https?:\/\//.test(tower) && !/^https:\/\/tower\.jp\//.test(tower)) {
      warn(line, "「タワーレコード」の列には、検索の言葉か tower.jp の URL を書きます（ほかのサイトの URL は「特設サイト」の列へ）");
    }
    const { videos, bad } = parseVideos(get("video"));
    for (const b of bad) err(line, `動画「${b}」の書き方が正しくありません（例：MV=XRnX65LDRoU、予告編=https://www.youtube.com/watch?v=…）`);

    if (errors.length > before && (!title || !start)) continue; // 年か出来事がない行は、年表に入れない
    const num = (v) => (v ? +v : 0);
    const [y, m, d] = start.split("-").map(num), [ey, em, ed] = end.split("-").map(num);
    events.push({ line, i: events.length, y, m: m || 0, d: d || 0, ey: ey || 0, em: em || 0, ed: ed || 0,
      cats: cats.length ? cats : [HISTORY_DEFAULT_CATEGORY], title, note: get("note"), site, tower, videos });
  }
  // 古い順（同じ日は CSV に書いた順）。月・日がないものは、その年・その月のはじめに
  events.sort((a, b) => a.y - b.y || a.m - b.m || a.d - b.d || a.i - b.i);
  return { events, errors, warnings };
}

/* ---------- ライブのセトリ（setlists.csv） ---------- */

// 「ライブのセトリ」のページ（setlist.html）のデータです。1行が1つの公演です。ライブ名が同じ公演は、1つのツアーとしてまとめて表示します。
//   本編・アンコール：曲名を「／」で区切って、演奏した順に書きます（例：DADA／有心論）。
//   曲名のうしろの（　）は、その曲のメモです（例：25コ目の染色体（アコースティック）、Tokyo（feat. iri））。
//   （　）の前までが曲名として数えられるので、同じ曲は同じ書き方にそろえてください。
//   確かさ：SETLIST_CONFIDENCE のどれか（ページでは、色のちがう札で表示します）
export const SETLIST_CONFIDENCE = [
  { name: "確認済み", slug: "ok", label: "確認済み", desc: "報道のライブレポートに載ったセットリスト" },
  { name: "未確認", slug: "fan", label: "未確認（ファンの投稿）", desc: "ファンが投稿するサイト（LiveFans など）の情報。まちがいがあるかもしれません" },
  { name: "一部", slug: "part", label: "一部だけ", desc: "ライブレポートの本文に出てくる曲を順に並べたもの。全曲ではない可能性があります" },
  { name: "映像", slug: "video", label: "映像の収録曲", desc: "ライブ映像の作品に収められた曲。ツアーのいくつかの公演から選んだもので、1つの公演の曲順ではありません" },
  { name: "セトリなし", slug: "none", label: "セトリ未確認", desc: "セットリストは、まだ確かめられていません（曲が書いてあるときは、記事などからの推測です）" }
];
// 区分：ページの「ライブ」で、この5つに分けて見られます（ライブ名が同じ公演は、同じ区分にそろえます）
export const SETLIST_CATEGORIES = ["国内ツアー", "海外ツアー", "フェス", "ボクンチ忘年会", "単発ライブ"];
const SETLIST_COLUMNS = {
  "区分": "cat", "公演日": "date", "ライブ名": "name", "会場": "venue", "本編": "main", "アンコール": "encore", "ゲスト": "guests",
  "確かさ": "conf", "出典": "source", "出典URL": "url", "メモ": "note"
};
const SETLIST_REQUIRED = ["公演日", "ライブ名", "本編", "確かさ"];

// 曲名（（　）の前まで）と、メモ（（　）の中）に分けます：「25コ目の染色体（アコースティック）」→ { title: "25コ目の染色体", memo: "アコースティック" }
export function splitSong(text) {
  const m = String(text).trim().match(/^(.*?)\s*（([^（）]*)）$/);
  return m && m[1] ? { title: m[1].trim(), memo: m[2].trim() } : { title: String(text).trim(), memo: "" };
}
// 同じ曲かどうかを見るための名前（全角・半角、空白、大文字・小文字のちがいは気にしない）
export const songKey = (title) => nfkc(title).replace(/\s+/g, "").toLowerCase();

// 戻り値：{ lives: 公演の一覧（古い順）, errors: 直す必要がある問題, warnings: 気をつけたい点 }
export function parseSetlists(text) {
  const lives = [], errors = [], warnings = [];
  const err = (line, msg) => errors.push({ line, msg });
  const warn = (line, msg) => warnings.push({ line, msg });
  const { rows, lines, unclosedQuote, lastLine } = parseCSV(text);
  if (unclosedQuote) err(lastLine, "「\"」で始めた項目が閉じられていません。\" の数を確かめてください");
  if (!rows.length || rows.every((r) => r.every((c) => !c.trim()))) { err(1, "ファイルが空です"); return { lives, errors, warnings }; }
  const col = readHeader(rows, SETLIST_COLUMNS, SETLIST_REQUIRED, errors, warnings);
  if (errors.length) return { lives, errors, warnings };
  const confNames = SETLIST_CONFIDENCE.map((c) => c.name).join("・");

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r], line = lines[r];
    if (cells.every((c) => !c.trim())) continue;
    const get = (key) => (col[key] === undefined ? "" : String(cells[col[key]] ?? "").trim());
    const before = errors.length;
    const name = get("name");
    if (!name) err(line, "ライブ名が空欄です");
    if (!get("date")) err(line, "公演日が空欄です（「2019-08-29」のように書きます。日にちがわからないときは「2019-08」）");
    const date = readDateCell(get("date"), line, err);
    const songs = (s) => splitList(s, /[／]/).map(splitSong);
    const main = songs(get("main")), encore = songs(get("encore"));
    // 曲の区切りは全角の「／」だけ（半角の「/」は曲名の一部として読む）
    if (/\//.test(get("main") + get("encore"))) warn(line, "曲の区切りは全角の「／」です。半角の「/」は曲名の一部として読みます");
    const conf = SETLIST_CONFIDENCE.find((c) => c.name === nfkc(get("conf")));
    if (!conf) err(line, `確かさ「${get("conf")}」は使えません。${confNames} のどれかを書いてください`);
    if (!main.length && conf && conf.slug !== "none") err(line, "本編の曲が空欄です（曲名を「／」で区切って書きます。セトリがわからない公演は、確かさを「セトリなし」にします）");
    // 「セトリなし」でも、演奏したと思われる曲を書いておける（ページでは「セトリ未確認」の札のまま出ます。メモに理由を書きます）
    if (main.length + encore.length && conf && conf.slug === "none" && !get("note")) warn(line, "確かさが「セトリなし」なのに曲が書いてあります。推測の曲なら、メモにそう書いてください");
    let url = get("url");
    if (url && !/^https:\/\/[^\s"<>]+$/.test(url)) { warn(line, "出典URL は https:// で始まるものだけ使えます（このリンクは出ません）"); url = ""; }
    if (!url && conf && conf.slug !== "video" && conf.slug !== "none") warn(line, "出典URL が空欄です（どこで確かめたかを残しておくと、あとで見直せます）");
    const cat = nfkc(get("cat"));
    if (col.cat !== undefined && !SETLIST_CATEGORIES.includes(cat)) warn(line, `区分「${get("cat")}」は使えません。${SETLIST_CATEGORIES.join("・")} のどれかを書いてください（空欄だと「すべて」のときだけ出ます）`);
    if (errors.length > before) continue;
    const [y, m = 0, d = 0] = date.split("-").map((v) => +v || 0);
    lives.push({ cat: SETLIST_CATEGORIES.includes(cat) ? cat : "", line, i: lives.length, date, y, m, d, name, venue: get("venue"), main, encore,
      guests: splitList(get("guests"), /[、,]/), conf, source: get("source"), url, note: get("note") });
  }
  lives.sort((a, b) => a.y - b.y || a.m - b.m || a.d - b.d || a.i - b.i);
  return { lives, errors, warnings };
}

/* ---------- CSV の1行を作る（記事データ作成ツール用） ---------- */

export const ARTICLE_HEADER = ["状態", "年", "月", "日", "媒体", "種類", "カテゴリ", "タイトル", "URL", "メンバー", "対談相手", "タグ", "言語", "メモ", "説明", "公演日", "ライブ名", "会場", "id"];

export function toCSVLine(cells) {
  return cells.map((v) => {
    v = String(v ?? "");
    return /[",\n\r]|^\s|\s$/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }).join(",");
}
