// assets/history.js
// 「RADWIMPSの歩み」のページの動き。年表のデータは data/history.csv です（ここを書き換えると年表が変わります）。
// 上のタブでカテゴリを選ぶと、そのカテゴリの出来事だけが並びます（URL の末尾 #release などでも開けます）。
// 「MV」のタブ（#mv）は、MV のある曲だけを1曲ずつ並べます。
// 「ライブ・ツアー」の出来事には、行ったことのあるライブの印（ブックマーク）をつけられます。印は「RAD LIVE SET LIST」の公演日と同じもので、連動します（attended.js）。
//   どの出来事がどの公演か：data/setlists.csv の公演のうち、出来事の日付（期間）に入るもの。期間の中に別のライブ（フェスなど）があるときは、いちばん公演数の多いツアーだけ。

import "./analytics.js";
import { parseHistory, parseSetlists, parseSites, parseArticles, parseSongs, tagsForArticle, MEMBERS, linkHistorySites, historyShows, historyLinkItems, historyTagIndex, tagsForNames, quotedNames, tagSearchWords, siteKey, historySearchText, matchHistory, HISTORY_CATEGORIES } from "./data.js";
import { attendButton, attendCount, assignKeys, sync as syncAttend, setupAttendClicks } from "./attended.js";
import { h as el, setupMenu, isAdminDevice, watchScrollFade, watchStuck } from "./ui.js";
import config from "./config.js";
import { feedbackUrl, hasFeedback, setupBeta, KIND, repoUrl } from "./feedback.js";
import { looseMatchAll } from "./search.js"; // ゆるい一致は「RAD LIVE SET LIST」の検索窓と同じもの

const $ = (s) => document.querySelector(s);

// カテゴリ（CSV に書く名前・URL の末尾・スマホのタブの短い名前）は、data.js の HISTORY_CATEGORIES で決めています
const CATS = HISTORY_CATEGORIES;
// 「MV」のタブ：「動画」の列で「MV」から始まるラベルの動画を、1曲ずつの行にして並べる（CSV に書く必要はありません）
const MV_TAB = { name: "MV", slug: "mv", short: "MV" };
const VIEWS = ["all", ...CATS.map((c) => c.slug), MV_TAB.slug];

let events = [];
let lives = [];   // セトリのデータ（data/setlists.csv）の公演。読めないときは空（印は出ません）
let current = "all";
let query = "";   // 検索窓の言葉。タブを切り替えても残す（どのタブも同じ年表の出来事なので）
let ready = false; // 年表・特設サイト・セトリをすべて読み終えたら true（それまでは検索しても描かない）
let shown = null;  // いま年表に並べている出来事（検索で中身が変わらないときは、作り直さないため）
let sourceTexts = { history: "", sites: "", setlists: "" }; // ページを開いたときに読んだ CSV（年表の管理の「保存せずに試す」で使う）
let adminApi = null; // 年表の管理（管理者モードの端末だけ。assets/admin-history.js）
let articleById = new Map(); // 記事データ（data/articles.csv）の公開している記事。関連リンクの「記事:id」から、タイトルと媒体を出すため
const itemEvent = new WeakMap(); // 年表の行（li）→ その出来事（記事データを読み終えたとき、関連リンクの行だけを足すため）
let articlesLoading = null;

const pad = (n) => String(n).padStart(2, "0");
function dateLabel(e) {
  const one = (m, d) => (m ? (d ? `${pad(m)}.${pad(d)}` : `${pad(m)}月`) : "");
  const start = one(e.m, e.d);
  if (!e.ey) return start;
  const end = (e.ey !== e.y ? `${e.ey}.` : "") + one(e.em, e.ed);
  return `${start} – ${end}`;
}


// 年表のデータを読む（読み取りは data.js の parseHistory。公開前のチェック tools/validate.mjs でも同じものを使う）
function load(text) {
  const { events, errors } = parseHistory(text);
  // 書き間違いは公開前のチェックでエラーになるので、ここでは読めた行だけを並べる
  if (errors.length) console.warn("年表のデータに、直すところがあります", errors);
  return events.map((e) => ({ ...e, cat: e.cats[0] }));
}

// 出来事に当てはまる公演（セトリのデータから）。ライブ・ツアーの出来事だけ
// 出来事に入る公演（data.js の historyShows。「RAD LIVE SET LIST」と同じ決まり）。
// 特設サイトの一覧から足した行には出さない（同じツアーの行が別にあると、「行った」の印が2か所に出てしまうため）
const showsOf = (e) => historyShows(e, lives);
// 出来事の下の「行った」ボタン。1公演だけならボタン、複数ならたたんだ欄に公演日を並べる
function attendLine(e) {
  const shows = e.shows;
  if (!shows || !shows.length) return null;
  if (shows.length === 1) return el("p", { class: "att-line" }, attendButton(shows[0]));
  const sameYear = shows.every((l) => l.y === shows[0].y);
  const chips = el("div", { class: "att-chips" }, ...shows.map((l) => attendButton(l, { label: `${sameYear ? "" : `${l.y}.`}${pad(l.m)}.${pad(l.d)} ${(l.venue || "").replace(/（.*）$/, "")}`.trim() })));
  return el("details", { class: "att-shows" }, el("summary", {}, "行った公演を選ぶ", attendCount(shows)), chips);
}

// center：選んでいるタブが見えるところまで、タブの帯を横に動かす（タブを選んだときだけ。検索のたびには動かさない）
function renderTabs({ center = true } = {}) {
  const tabs = $("#tabs");
  const keep = tabs.scrollLeft; // 作り直す前の横の位置
  tabs.replaceChildren();
  tabs.className = `hist-tabs wrap cat-${current}`; // 下の細い線の色は、選んでいるカテゴリの色
  const all = [{ name: "すべて", slug: "all", short: "すべて" }, ...CATS, MV_TAB];
  for (const t of all) {
    // 件数は、検索しているときは検索に合う出来事の数（パソコンの幅では、件数はタブの数字だけに出るため）
    const n = inTab(t.slug).filter(hit).length;
    const b = el("button", { type: "button", role: "tab", class: `hist-tab cat-${t.slug}`, "aria-selected": String(t.slug === current), "data-cat": t.slug, "aria-label": `${t.name} ${n}件` },
      el("span", { class: "lbl-full", text: t.name }), el("span", { class: "lbl-short", text: t.short, "aria-hidden": "true" }), el("small", { text: String(n) }));
    tabs.append(b);
  }
  // 入りきらないときは、選んでいるタブが見えるところまで横にスクロールする
  const on = tabs.querySelector('[aria-selected="true"]');
  if (!center) tabs.scrollLeft = keep;
  else if (on) tabs.scrollTo({ left: on.offsetLeft - (tabs.clientWidth - on.offsetWidth) / 2, behavior: "auto" });
}

// 検索窓の言葉に合うか。探す文字は data.js の historySearchText（出来事・補足・年・カテゴリ・動画の名前・特設サイト・タグ）。
//   全角半角・ひらがなとカタカナの違いは気にしない。英語の名前はひらがなでも見つかる（例：「ふぉーえばー」→ FOREVER IN THE DAZE TOUR）。
//   空白で区切ると、すべての言葉に合うものだけ（例：「ツアー 2016」）
//   「4月」「4月5日」の形の言葉は、月日でぴったり比べる（data.js の matchHistory。「1月」が「11月」に合わないように）
const searchTexts = new WeakMap(); // 探す文字は、出来事ごとに一度だけ作る（出来事を作り直したときは、新しく作られる）
let tagIndex = null; // タグの共通化：同じ名前（「」の中）のほかの出来事に付けたタグでも見つかる（data.js の historyTagIndex）
function searchText(e) {
  if (!searchTexts.has(e)) searchTexts.set(e, [historySearchText(e), e.mv ? "" : tagSearchWords(tagsForNames(tagIndex, quotedNames(e.title)))].join("|"));
  return searchTexts.get(e);
}
const hit = (e) => !query.trim() || matchHistory(e, query, looseMatchAll, searchText);
const inTab = (slug) => (slug === "all" ? events : slug === "mv" ? mvSongs() : events.filter((e) => e.cats.some((c) => c.slug === slug)));

function renderTimeline() {
  closePlayer(); // 作り直すと動画の場所がなくなるので、先に閉じる
  const box = $("#timeline");
  const base = inTab(current);
  const list = base.filter(hit);
  shown = list;
  // 今見ているカテゴリの名前と件数（スマホではタブに件数を出さないので、ここに出す）
  const view = current === "all" ? "すべての出来事" : current === "mv" ? "MV（ない曲は公式のライブ映像など）" : CATS.find((c) => c.slug === current).name;
  $("#view").replaceChildren(el("b", { text: view }), el("span", { text: `${list.length} 件` }));
  // 年表の点の色：カテゴリのタブでは、そのカテゴリの色。「すべて」では、はじめに書いたカテゴリの色
  const dot = (e) => e.cats?.find((c) => c.slug === current) || e.cat;
  const years = new Map();
  for (const e of list) (years.get(e.y) || years.set(e.y, []).get(e.y)).push(e);
  box.replaceChildren();
  for (const [y, items] of years) {
    const sec = el("section", { class: "hist-year", id: `y${y}`, "aria-labelledby": `yh${y}` },
      el("h2", { id: `yh${y}`, class: "hist-year-head" }, el("span", { text: String(y) }), el("small", { text: `${items.length} 件` })));
    const ol = el("ol", { class: "hist-list" });
    for (const e of items) {
      const li = el("li", { class: `hist-item cat-${dot(e).slug}` },
        el("p", { class: "hist-meta" },
          e.m ? el("time", { text: dateLabel(e) }) : null,
          ...(e.cats || [e.cat]).map((c) => el("span", { class: `hist-cat cat-${c.slug}`, text: c.name }))),
        ...titleLine(e),
        e.note ? el("p", { class: "hist-sub", text: e.note }) : null,
        attendLine(e),
        videoLine(e),
        siteLine(e),
        linkLine(e),
        editLine(e));
      itemEvent.set(li, e);
      ol.append(li);
    }
    sec.append(ol);
    box.append(sec);
  }
  if (!list.length) box.append(el("p", { class: "hist-loading", text: query.trim() && base.length
    ? `「${query.trim()}」に合う出来事は、見つかりませんでした。ひらがなや英語、作品名の一部でも探せます。`
    : current === "mv" ? "MV はまだありません。" : "このカテゴリの出来事はまだありません。" }));
  renderEras(list);
  syncAttend(box);
}

// MV のある曲を1曲ずつの行にする。曲名は、ラベルの「」の中（MV「光」→ 光）か、ラベルが「MV」だけなら出来事の「」の中の名前。
// 下の小さな文字に、もとの出来事（シングル・アルバムなど）を出す。
// MV が見当たらない曲は、公式のライブ映像など（ラベルが「ライブ映像」「スタジオライブ」「リリックビデオ」で始まるもの）を代わりに並べる。
//   その曲の MV がどこかの行にあれば並べない。同じ曲のライブ映像がいくつかあれば、いちばん早い行の1つだけ。
const MV_LIVE = /^(ライブ映像|スタジオライブ|リリックビデオ)/;
let mvCache = null;
function mvSongs() {
  if (mvCache) return mvCache;
  const firstName = (t) => (t.match(/[「『]([^」』]+)[」』]/) || [])[1] || t;
  const nameOf = (e, label, prefix) => {
    const rest = label.slice(prefix.length).trim();
    return /^「.+」$/.test(rest) ? rest.slice(1, -1) : firstName(e.title) + (rest ? (/^[（(]/.test(rest) ? rest : ` ${rest}`) : "");
  };
  // 同じ曲かどうかを見るための名前（「(movie ver.)」などのちがい、空白、大文字・小文字は気にしない）
  const songKey = (name) => name.replace(/\s*[（(［\[].*$/, "").replace(/\s+/g, "").toLowerCase();
  const item = (e, v, j, name, label, tag = MV_TAB) => ({ y: e.y, m: e.m, d: e.d, ey: 0, em: 0, ed: 0, cat: MV_TAB,
    cats: [tag, ...e.cats.filter((c) => c.person)], title: `「${name}」`, note: e.title, i: e.i * 100 + j, mv: true,
    site: "", tower: "", videos: [{ label, id: v.id }] });
  const mvs = [], lives = [], seen = new Set();
  for (const e of events) e.videos.forEach((v, j) => {
    if (/^MV/.test(v.label)) {
      // 同じ MV がいくつかの行にあるときは、いちばん早い行の1つだけ（例：先に公開した MV と、それを収めたアルバム）
      if (seen.has(v.id)) return;
      seen.add(v.id); mvs.push(item(e, v, j, nameOf(e, v.label, "MV"), "MV を見る"));
    }
    else if (MV_LIVE.test(v.label)) { const p = v.label.match(MV_LIVE)[1]; lives.push(item(e, v, j, nameOf(e, v.label, p), `${p}を見る`, { ...MV_TAB, name: p })); }
  });
  const have = new Set(mvs.map((x) => songKey(x.title.slice(1, -1))));
  const subs = lives.filter((x) => { const k = songKey(x.title.slice(1, -1)); if (have.has(k)) return false; have.add(k); return true; });
  mvCache = [...mvs, ...subs].sort((a, b) => a.y - b.y || a.m - b.m || a.d - b.d || a.i - b.i);
  return mvCache;
}

// 「CD を探す」のお店（タワーレコード・Amazon・楽天）。楽曲一覧の「CD を探す」と同じ形です。
//   CSV の「タワーレコード」の列には、検索する言葉（例：RADWIMPS 人間開花）か、tower.jp の商品ページの URL を書く。
//   Amazon と楽天は、検索する言葉で探す（商品ページの URL を書いた行は「RADWIMPS 作品名」で探す）。
//   config.js にバリューコマースの sid・pid（タワーレコード）、amazonTag（Amazon）、rakutenAffiliate（楽天）を書くと、
//   そのお店のリンクがアフィリエイトリンクになり、「PR」が出ます。空欄のお店は、ふつうのリンクです。
const AFF = config.towerAffiliate || {};
const towerAff = !!(AFF.sid && AFF.pid);
const amazonTag = /^[\w-]+-22$/.test(config.amazonTag || "") ? config.amazonTag : "";
const rakutenId = /^[0-9a-f]{8}(\.[0-9a-f]{8}){3}$/.test(config.rakutenAffiliate || "") ? config.rakutenAffiliate : "";
const SHOPS = [
  { name: "タワレコ", aff: towerAff, url: (v) => {
    const plain = /^https:\/\/tower\.jp\/[^\s"<>]*$/.test(v) ? v : `https://tower.jp/search/item/${encodeURIComponent(v)}`;
    return towerAff ? `https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=${encodeURIComponent(AFF.sid)}&pid=${encodeURIComponent(AFF.pid)}&vc_url=${encodeURIComponent(plain)}` : plain;
  } },
  { name: "Amazon", aff: !!amazonTag, url: (v, word) => `https://www.amazon.co.jp/s?k=${encodeURIComponent(word)}&i=music${amazonTag ? `&tag=${amazonTag}` : ""}` },
  { name: "楽天", aff: !!rakutenId, url: (v, word) => {
    const plain = `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(word)}/`;
    return rakutenId ? `https://hb.afl.rakuten.co.jp/hgc/${rakutenId}/?pc=${encodeURIComponent(plain)}&link_type=text` : plain;
  } }
];
const affiliateOn = SHOPS.some((s) => s.aff);
let buyId = 0;
// 作品名を押すと、出来事のすぐ下に開く「CD を探す」の行
function buyPanel(e, name) {
  const word = /^https:/.test(e.tower) ? `RADWIMPS ${name}` : e.tower;
  return el("p", { class: "hist-buy", id: `buy${++buyId}`, hidden: "" },
    el("span", { class: "hist-buy-label", text: "CD を探す" }),
    ...SHOPS.map((s) => el("a", { class: "hist-shop", href: s.url(e.tower, word), target: "_blank",
      rel: s.aff ? "sponsored noopener noreferrer" : "noopener noreferrer",
      "aria-label": `「${name}」を${s.name}で探す（新しいタブ）${s.aff ? "（広告）" : ""}` },
      `${s.name} ↗`, s.aff ? el("span", { class: "pr", text: "PR" }) : null)));
}

// 出来事の見出し。いちばん初めの「」か『』の中（作品名・ライブ名）を、押せるようにする。
//   リリース（CSV の「タワーレコード」の列がある行）：押すと、すぐ下に「CD を探す」（タワレコ・Amazon・楽天）が開く
//   ライブなど：特設サイト、なければ公式サイトのライブ情報のページ（「特設サイト」の列）へのリンク
//   押せるのは作品名の文字だけ（行全体にはしない）。点線の下線で、控えめに示す。
//   見出しと、開く行（「CD を探す」）を配列で返す
function titleLine(e) {
  const p = el("p", { class: "hist-title" });
  const href = e.tower || e.site;
  const m = href ? e.title.match(/[「『]/) : null;
  if (!m) { p.textContent = e.title; return [p]; }
  const open = m.index, close = e.title.indexOf(m[0] === "「" ? "」" : "』", open + 1);
  if (close < 0) { p.textContent = e.title; return [p]; }
  const name = e.title.slice(open + 1, close);
  if (e.tower) {
    const panel = buyPanel(e, name);
    const b = el("button", { type: "button", class: "title-link title-buy", "aria-expanded": "false", "aria-controls": panel.id,
      title: `押すと「${name}」の CD を探すお店（タワレコ・Amazon・楽天）が開きます` }, name);
    p.append(e.title.slice(0, open + 1), b, e.title.slice(close));
    return [p, panel];
  }
  const a = el("a", {
    class: "title-link", href, target: "_blank", rel: "noopener noreferrer",
    title: /radwimps\.jp\/live(_archive)?\//.test(href) ? `「${name}」の公式サイトのライブ情報（新しいタブで開きます）`
      : /radwimps\.jp\/news\//.test(href) ? `「${name}」についての公式サイトのお知らせ（新しいタブで開きます）`
      : /\/\/radwimps\.jp\//.test(href) ? `「${name}」の特設サイト（新しいタブで開きます）` : `「${name}」の公式ページ（新しいタブで開きます）`
  }, name);
  p.append(e.title.slice(0, open + 1), a, e.title.slice(close));
  return [p];
}

// 特設サイト（data/sites.csv）。出来事の下に小さく「特設サイト ↗」を出す（11/22 に「特設サイト」の部屋をやめ、歩みだけに出すことにした）。
//   公開が終わったサイトは「特設サイト（公開終了）」として、Internet Archive の保存版へつなぐ（保存版がなければ文字だけ）
function siteLine(e) {
  // 見出しの作品名・ライブ名が、すでに同じ特設サイト（公開中）へのリンクになっているものは出さない（同じリンクが2つ並ばないように）
  const list = (e.sites || []).filter((s) => s.closed || !e.site || siteKey(s.url) !== siteKey(e.site));
  if (!list.length) return null;
  const p = el("p", { class: "hist-sites" });
  list.forEach((s, i) => {
    if (i) p.append(el("span", { class: "sep", "aria-hidden": "true", text: "·" }));
    const href = s.closed ? s.archive : s.url;
    const label = s.closed ? "特設サイト（公開終了）" : "特設サイト";
    p.append(href
      ? el("a", { href, target: "_blank", rel: "noopener noreferrer", "aria-label": `${s.name}の${s.closed ? "特設サイトの保存版（Internet Archive）" : "特設サイト"}を新しいタブで開く` }, `${label}${s.closed ? "の保存版" : ""} ↗`)
      : el("span", { text: label }));
  });
  return p;
}

// 関連リンク：CSV の「関連リンク」の列。記事一覧の記事（記事:id）と、ほかのページ（ラベル=URL）へのリンクを、出来事の下に並べる（新しいタブで開く）
//   記事は、記事データにあって「公開」のものだけ出す（記事データを読み終える前や、見つからない記事は出さない）
function linkLine(e) {
  if (e.mv || !e.links?.length) return null;
  // リンクの一覧は data.js の historyLinkItems（SET LIST と同じ）
  const items = historyLinkItems(e, articleById).map((x) => x.kind
    ? el("a", { href: x.href, target: "_blank", rel: "noopener noreferrer", "aria-label": `${x.kind}「${x.title}」（${x.media}）を新しいタブで開く` },
      el("span", { class: "hist-link-kind", text: x.kind }), `${x.title} ↗`)
    : el("a", { href: x.href, target: "_blank", rel: "noopener noreferrer", "aria-label": `${x.title}（新しいタブで開く）` }, `${x.title} ↗`));
  if (!items.length) return null;
  const p = el("p", { class: "hist-sites hist-links" });
  items.forEach((a, i) => { if (i) p.append(el("span", { class: "sep", "aria-hidden": "true", text: "·" })); p.append(a); });
  return p;
}
// 記事データを読む（関連リンクに記事があるときと、年表の管理で記事を選ぶときだけ）。読めなくても、年表はそのまま見られる
//   戻り値：すべての記事（状態で絞る前。年表の管理で「非表示なので出ません」と知らせるため）。読めなかったときは null（次に呼んだとき、読み直す）
function loadArticles() {
  if (!articlesLoading) articlesLoading = fetch("data/articles.csv", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(); return r.text(); })
    .then((t) => {
      const items = parseArticles(t).items;
      articleById = new Map(items.filter((it) => it.state === "公開" && it.url).map((it) => [it.id, it]));
      return items;
    })
    .catch(() => { articlesLoading = null; return null; });
  return articlesLoading;
}
// 記事データを読み終えたら、関連リンクの行だけを足す（年表を作り直すと、開いている動画や「CD を探す」が閉じてしまうため）
function addLinkLines() {
  for (const li of document.querySelectorAll("#timeline .hist-item")) {
    const e = itemEvent.get(li);
    if (!e || !e.links?.some((l) => l.type === "article")) continue;
    const line = linkLine(e), old = li.querySelector(".hist-links");
    // ほかのページのリンクだけ先に出ている行は、記事を入れた行に差し替える
    if (old) { if (line) old.replaceWith(line); }
    else if (line) li.insertBefore(line, li.querySelector(".hist-edits, .hist-player"));
  }
}

// 年表の管理（管理者モードの端末だけ）：出来事の下の「直す」。特設サイトがつながっていれば、その特設サイトの「直す」も
//   data-hedit：data/history.csv の行番号　data-sedit：data/sites.csv の行番号（MV のタブの行は、もとの出来事から作ったものなので出さない）
function editLine(e) {
  if (!adminApi || e.mv) return null;
  const btns = [];
  if (e.line && !e.fromSites) btns.push(el("button", { type: "button", class: "hist-edit", "data-hedit": String(e.line), text: "直す" }));
  for (const s of e.sites || []) btns.push(el("button", { type: "button", class: "hist-edit", "data-sedit": String(s.line), "aria-label": `特設サイト「${s.name}」を直す`, text: "特設サイトを直す" }));
  return btns.length ? el("p", { class: "hist-edits" }, ...btns) : null;
}

// 動画（MV・予告編など）。CSV の「動画」の列に「ラベル=YouTube の ID か URL」を「 | 」で区切って書く。
//   例：MV=XRnX65LDRoU　／　MV「光」=WuU6C8oXzIA | MV「前前前世 [original ver.]」=vLGQQbjZc5A　／　予告編=https://www.youtube.com/watch?v=…
// 出来事の下に、小さな文字で「▶ MV」などを並べる。押すと、その場（出来事のすぐ下）で再生する
function videoLine(e) {
  if (!e.videos.length) return null;
  const p = el("p", { class: "hist-videos" });
  e.videos.forEach((v, i) => {
    if (i) p.append(el("span", { class: "sep", "aria-hidden": "true", text: "·" }));
    p.append(el("button", { type: "button", class: "vbtn", "data-vid": v.id, "data-label": v.label, "aria-expanded": "false" },
      el("span", { class: "tri", "aria-hidden": "true", text: "▶" }), el("span", { class: "vl", text: v.label })));
  });
  return p;
}
function closePlayer() {
  const open = $("#timeline .hist-player");
  if (!open) return;
  open._io?.disconnect();
  open._vis?.disconnect();
  document.body.classList.remove("player-in-view");
  open.remove();
  document.querySelectorAll('#timeline .vbtn[aria-expanded="true"]').forEach((b) => b.setAttribute("aria-expanded", "false"));
}
function openPlayer(btn) {
  const id = btn.dataset.vid, label = btn.dataset.label;
  const li = btn.closest(".hist-item");
  const title = li.querySelector(".hist-title").textContent;
  const iframe = el("iframe", {
    title: `${label}（${title}）`, referrerpolicy: "strict-origin-when-cross-origin", frameborder: "0",
    allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen", allowfullscreen: ""
  });
  const frame = el("div", { class: "frame" }, iframe);
  const close = el("button", { type: "button", class: "pclose", text: "閉じる" });
  close.addEventListener("click", () => { closePlayer(); btn.focus(); });
  const player = el("div", { class: "hist-player" }, frame,
    el("p", { class: "player-foot" },
      el("a", { href: `https://www.youtube.com/watch?v=${id}`, target: "_blank", rel: "noopener noreferrer", text: "YouTube で開く" }), close));
  li.append(player);
  btn.setAttribute("aria-expanded", "true");
  // YouTube の決まり：自動で再生を始めるのは、プレーヤーが半分以上見えてから。
  // 動画はプレーヤーが半分以上見えたときに読み込み、見えていなければ見える位置まで動かす
  const start = () => { if (!iframe.getAttribute("src")) iframe.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0`; };
  if (!("IntersectionObserver" in window)) return start();
  player._io = new IntersectionObserver((list) => {
    if (list.some((x) => x.intersectionRatio >= 0.5)) { player._io.disconnect(); start(); }
  }, { threshold: [0.5] });
  player._io.observe(frame);
  // プレーヤーが見えているあいだは、右下の「↑」ボタンを隠す（YouTube の決まりで、プレーヤーの上に何も重ねない）
  player._vis = new IntersectionObserver(([x]) => document.body.classList.toggle("player-in-view", x.isIntersecting));
  player._vis.observe(frame);
  frame.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// スクロール中の誤タップを防ぐ：画面がまだ動いている最中（0.25秒以内）に触れたタップや、指が滑ったタップでは、リンクや動画を開かない
// （スクロールの勢いを止めようとして触れたときに、リンクが開いてしまうのを防ぐ。マウスのクリックはそのまま）
const GUARD_MS = 250;
let lastScroll = 0, tap = { touch: false, x: 0, y: 0, moved: false, scrolling: false };
addEventListener("scroll", () => { lastScroll = performance.now(); }, { passive: true });
document.addEventListener("pointerdown", (e) => {
  tap = { touch: e.pointerType !== "mouse", x: e.clientX, y: e.clientY, moved: false, scrolling: performance.now() - lastScroll < GUARD_MS };
}, { passive: true });
document.addEventListener("pointermove", (e) => {
  if (tap.touch && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 10) tap.moved = true;
}, { passive: true });

// 「年を選ぶ」メニュー（丸い枠の1つ）。2001年から今まで、表示中の出来事がある年が並び、選んだ年へ飛ぶ
function renderEras(list) {
  const nav = $("#eras");
  const years = [...new Set(list.map((e) => e.y))];
  const sel = el("select", { class: "era-select", "aria-label": "年を選ぶ（選んだ年へ移動）" },
    el("option", { value: "", text: "年を選ぶ" }), ...years.map((y) => el("option", { value: String(y), text: `${y}年` })));
  if (!years.length) { sel.disabled = true; sel.classList.add("off"); }
  nav.replaceChildren(sel);
}

function setCat(slug, { scroll = false } = {}) {
  current = VIEWS.includes(slug) ? slug : "all";
  renderTabs();
  renderTimeline();
  history.replaceState(null, "", current === "all" ? location.pathname + location.search : `#${current}`);
  if (scroll) {
    const top = $(".hist-tabs-bar").getBoundingClientRect().top + scrollY - headerH();
    if (scrollY > top) scrollTo({ top });
  }
}

const headerH = () => $("#header").getBoundingClientRect().height;
// 上に残っているタブの帯（タブと検索窓）の高さ。背の低い画面では上に残さないので 0（style.css の max-height: 500px）
const stickyH = () => { const b = $(".hist-tabs-bar"); return getComputedStyle(b).position === "sticky" ? b.offsetHeight : 0; };

const tapIsAccident = () => tap.touch && (tap.moved || tap.scrolling);
$("#timeline").addEventListener("click", (e) => {
  const ed = e.target.closest("[data-hedit], [data-sedit]");
  if (ed) {
    if (!adminApi) return;
    if (ed.dataset.hedit) adminApi.editEvent(+ed.dataset.hedit); else adminApi.editSite(+ed.dataset.sedit);
    return;
  }
  if (e.target.closest("a.title-link, a.hist-shop")) { if (tapIsAccident()) e.preventDefault(); return; }
  const buy = e.target.closest(".title-buy");
  if (buy) {
    if (tapIsAccident()) return;
    const open = buy.getAttribute("aria-expanded") !== "true";
    buy.setAttribute("aria-expanded", String(open));
    document.getElementById(buy.getAttribute("aria-controls")).hidden = !open;
    return;
  }
  const btn = e.target.closest(".vbtn");
  if (!btn || tapIsAccident()) return;
  const wasOpen = btn.getAttribute("aria-expanded") === "true";
  closePlayer();
  if (!wasOpen) openPlayer(btn);
});

$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cat]");
  if (b) setCat(b.dataset.cat, { scroll: true });
});
// 左右の矢印キーでタブを移動
$("#tabs").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const bs = [...document.querySelectorAll(".hist-tab")];
  const i = bs.findIndex((b) => b.getAttribute("aria-selected") === "true");
  const next = bs[(i + (e.key === "ArrowRight" ? 1 : bs.length - 1)) % bs.length];
  setCat(next.dataset.cat);
  document.querySelector(`.hist-tab[data-cat="${next.dataset.cat}"]`).focus();
});
// 「年を選ぶ」で年を選んだら、その年へ（上の帯とタブに隠れない位置へ）。
// メニューの表示を「年を選ぶ」に戻すのは、メニューから離れたとき（矢印キーで1年ずつ進めても、順に飛べるように）
$("#eras").addEventListener("change", (e) => {
  const sel = e.target.closest("select");
  if (!sel || !sel.value) return;
  const t = document.getElementById(`y${sel.value}`);
  if (t) scrollTo({ top: t.getBoundingClientRect().top + scrollY - headerH() - stickyH() - 8, behavior: "smooth" });
});
$("#eras").addEventListener("focusout", (e) => { if (e.target.matches("select")) e.target.value = ""; });
// マウスやタップで開くときも「年を選ぶ」に戻す（同じ年をもう一度選んでも、その年へ飛べるように）
$("#eras").addEventListener("pointerdown", (e) => { if (e.target.matches("select")) e.target.value = ""; });

// 検索窓：入れ終わって 0.15 秒たったら、年表を作り直す（楽曲一覧・RAD LIVE SET LIST と同じ）。Enter でキーボードを閉じる
const searchBox = $("#histSearch");
let searchTimer = 0;
searchBox.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 150);
});
// Enter でキーボードを閉じる（日本語の変換を確定する Enter では閉じない）
searchBox.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) searchBox.blur(); });
function runSearch() {
  query = searchBox.value;
  // URL の ?q= も今の言葉にする（再読み込みや共有で、消した言葉が戻らないように。ブラウザの履歴には積まない）
  const u = new URL(location.href);
  if (query.trim()) u.searchParams.set("q", query.trim()); else u.searchParams.delete("q");
  try { history.replaceState(null, "", u.pathname + u.search + u.hash); } catch { /* 変えられない環境 */ }
  if (!ready) return;
  renderXref();
  renderTabs({ center: false });
  // 合う出来事が変わらないときは、作り直さない（開いている「CD を探す」や、再生中の動画を閉じないように）。
  // 0件のときは、見つからないときの文に今の言葉を出すため、いつも作り直す
  const list = inTab(current).filter(hit);
  if (shown && list.length && list.length === shown.length && list.every((e, i) => e === shown[i])) return;
  renderTimeline();
}

// いちばん上へ戻るボタン
const toTop = $("#toTop");
addEventListener("scroll", () => { toTop.hidden = scrollY < 900; }, { passive: true });
toTop.addEventListener("click", () => scrollTo({ top: 0, behavior: "smooth" }));

// 「行った」ボタン
setupAttendClicks();
// メニュー（記事一覧のページと同じ動き。ui.js）
setupMenu();
watchScrollFade($("#tabs"));
watchStuck($(".hist-tabs-bar")); // 上に貼りついたときだけ、帯に暗い地を敷く
setupBeta($("#main").firstElementChild);
// フッターの「誤りを知らせる」（受付先は feedback.js で決まります）
if (hasFeedback) {
  $(".site-footer .footer-links").append(el("a", { href: feedbackUrl({ kind: KIND.error, title: "年表の誤りのお知らせ", page: "RADWIMPSの歩み（年表）" }), target: "_blank", rel: "noopener noreferrer", text: "年表の誤りを知らせる ↗" }));
}
if (isAdminDevice()) $("#adminLink").hidden = false;

/* ---------- ほかのページで見つかったもの（運営の希望 11/23） ---------- */
// 歩みの検索窓に言葉を入れると、年表の上に、楽曲一覧の曲・SET LIST のライブ・記事一覧の記事のうち、その言葉に合うものの例を並べる。
// 歩みで付けたタグも効く（data.js の historyTagIndex：出来事の「」の名前と同じ曲名・ツアー名・記事、関連リンクの記事）。
//   ・年表の結果を押し出さないよう、最初はたたんでおく（開いた・閉じたは、このページを開いているあいだ覚える）
//   ・各ページの検索とは比べ方が少しちがうので、件数は出さず、例を3件までと「〇〇で探す」（そのページで同じ言葉を検索した状態で開く）だけにする
// 曲と記事のデータは、はじめて言葉を入れたときに読む（読めなかったときは、次に言葉を入れたときに読み直す）
const XREF_MAX = 3;
let xref = null, xrefLoading = null, xrefOpen = false, xrefCache = null;
function loadXref() {
  if (!xrefLoading) {
    const get = (f) => fetch(f, { cache: "no-cache" }).then((r) => (r.ok ? r.text() : "")).catch(() => "");
    xrefLoading = Promise.all([get("data/songs.csv"), get("data/articles.csv")]).then(([songText, articleText]) => {
      if (!songText && !articleText) { xrefLoading = null; xref = { songs: [], articles: [], failed: true }; renderXref(); return; }
      let songs = [], articles = [];
      try { songs = songText ? parseSongs(songText).songs : []; } catch { /* 曲は出さない */ }
      try { articles = articleText ? parseArticles(articleText).items.filter((it) => it.state === "公開" && it.url) : []; } catch { /* 記事は出さない */ }
      xref = { songs, articles };
      renderXref();
    });
  }
  return xrefLoading;
}
// 探す文字の一覧。年表（タグ）・曲と記事のデータ・セトリが変わったときだけ作り直す（入力のたびに作らない）
function xrefLists() {
  if (xrefCache && xrefCache.tagIndex === tagIndex && xrefCache.xref === xref && xrefCache.lives === lives && xrefCache.events === events) return xrefCache.lists;
  const tagWords = (names) => tagSearchWords(tagsForNames(tagIndex, names));
  const seenSong = new Set();
  const songs = (xref?.songs || []).filter((s) => !seenSong.has(`${s.artist}|${s.title}`) && seenSong.add(`${s.artist}|${s.title}`)).map((s) => {
    const base = s.title.replace(/\s*\(?\s*feat\..*$/i, "").trim();
    return { label: s.title, sub: [s.work && s.work !== s.title ? `「${s.work}」` : "", s.y ? `${s.y}年` : ""].filter(Boolean).join(" "),
      href: `songs.html?q=${encodeURIComponent(base)}`, text: [s.title, s.work, s.album, s.tieup, s.artist, s.note, tagWords([s.title, base])].join("|") };
  });
  // ライブ：ライブ名ごと（SET LIST と同じまとめ方）。会場・日付・演奏した曲名と、期間でつながる歩みのライブの出来事のタグ・ツアー名と同じ名前のタグでも
  const tours = new Map();
  const pad2 = (n) => String(n).padStart(2, "0");
  for (const l of lives) {
    const t = tours.get(l.name) || tours.set(l.name, { name: l.name, y: l.y, words: new Set(), tags: new Set() }).get(l.name);
    if (l.venue) t.words.add(l.venue);
    t.words.add(l.d ? `${l.y}.${pad2(l.m)}.${pad2(l.d)}` : `${l.y}`);
    for (const x of [...(l.main || []), ...(l.encore || [])]) if (x.title) t.words.add(x.title);
  }
  for (const e of events) for (const l of e.shows || []) for (const x of e.tags || []) tours.get(l.name)?.tags.add(x);
  const liveList = [...tours.values()].map((t) => ({ label: t.name, sub: `${t.y}年`, href: `setlist.html?q=${encodeURIComponent(t.name)}#live`,
    text: [t.name, ...t.words, tagSearchWords([...t.tags]), tagWords([t.name])].join("|") })).reverse();
  // 記事：記事一覧の検索と同じ項目（メンバー・カテゴリ・説明・メモ・種類・日付・会場も）
  const articles = (xref?.articles || []).map((it) => ({ label: it.title, sub: [it.media, it.date ? it.date.slice(0, 4) + "年" : ""].filter(Boolean).join(" "), href: it.url, external: true,
    text: [it.title, it.media, (it.members || []).map((k) => (MEMBERS[k] ? `${MEMBERS[k].name} ${MEMBERS[k].kana || ""}` : "")).join(" "), it.guests.join(" "), it.tags.join(" "), (it.categories || []).join(" "), it.note, it.summary, it.kind, it.date, it.eventName, it.venue,
      tagSearchWords(tagsForArticle(tagIndex, it))].join("|") }));
  xrefCache = { tagIndex, xref, lives, events, lists: { songs, lives: liveList, articles } };
  return xrefCache.lists;
}
function renderXref() {
  let box = $("#histXref");
  const q = query.trim();
  if (!q) { if (box) box.hidden = true; return; }
  if (!box) {
    box = el("details", { class: "hist-xref", id: "histXref" });
    box.addEventListener("toggle", () => { xrefOpen = box.open; });
    $("#view").after(box);
  }
  if (!xref || (xref.failed && !xrefLoading)) {
    loadXref();
    box.hidden = true;
    return;
  }
  if (xref.failed) { box.hidden = true; return; }
  const { songs, lives: liveList, articles } = xrefLists();
  const pick = (list) => { const out = []; for (const x of list) if (looseMatchAll(x.text, q) && out.push(x) > XREF_MAX) break; return out; };
  const groups = [
    ["楽曲一覧の曲", pick(songs), `songs.html?q=${encodeURIComponent(q)}`, "楽曲一覧で探す"],
    ["RAD LIVE SET LIST のライブ", pick(liveList), `setlist.html?q=${encodeURIComponent(q)}#live`, "RAD LIVE SET LIST で探す"],
    ["記事一覧の記事", pick(articles), `articles.html?q=${encodeURIComponent(q)}&format=all`, "記事一覧で探す"]
  ].filter(([, list]) => list.length);
  if (!groups.length) { box.hidden = true; return; }
  box.hidden = false;
  box.open = xrefOpen;
  box.replaceChildren(
    el("summary", { class: "hist-xref-title" }, `ほかのページで「${q}」に合うもの`, el("small", { text: ` （${groups.map(([t]) => t.replace(/の(曲|ライブ|記事)$/, "").trim()).join("・")}）` })),
    el("div", { class: "hist-xref-body" }, ...groups.map(([title, list, more, moreText]) => el("div", { class: "hist-xref-group" },
      el("h3", { text: title }),
      el("ul", {}, ...list.slice(0, XREF_MAX).map((x) => el("li", {},
        el("a", { href: x.href, ...(x.external ? { target: "_blank", rel: "noopener noreferrer", "aria-label": `${x.label}（${x.sub}。新しいタブで開く）` } : {}) },
          el("span", { class: "hist-xref-label", text: x.label + (x.external ? " ↗" : "") }), x.sub ? el("small", { text: x.sub }) : null)))),
      el("a", { class: "hist-xref-more", href: more, text: `${list.length > XREF_MAX ? "ほかにもあります。" : ""}${moreText} →` })))));
}

// 年表の CSV（と特設サイトの CSV）から、出来事の一覧を作る。年表の管理で直したときも、ここから作り直す
function build(historyText, sitesText) {
  events = load(historyText);
  // 特設サイトを出来事につなぐ
  // 見出しのリンクと同じ特設サイトが「公開終了」なら、見出しのリンク先も保存版に（data.js の linkHistorySites。SET LIST と同じ）
  if (sitesText) events = linkHistorySites(events, parseSites(sitesText).sites).map((e) => ({ ...e, cat: e.cats[0] }));
  for (const e of events) e.shows = showsOf(e);
  tagIndex = historyTagIndex(events);
  mvCache = null;
  if (events.length) $("#span").textContent = `${events[0].y} — ${events[events.length - 1].y}`;
}

// 年表の管理：管理者モードの端末でだけ読み込む（ほかのサイトの中に埋め込まれているときは動かさない。記事一覧の運営管理と同じ）
// 管理者モードの端末で、年表の管理を出せなかったとき：理由を欄に出す（黙って何も出さないと、運営が原因を見分けられないため）
function adminNote(text) {
  const box = $("#histAdmin");
  box.replaceChildren(el("div", { class: "hadm-card" },
    el("div", { class: "hadm-head" }, el("h2", { id: "histAdminTitle", text: "年表の管理" })),
    el("p", { class: "hadm-msg err", role: "alert", text })));
  box.hidden = false;
}
function setupAdmin() {
  const framed = (() => { try { return window.self !== window.top; } catch { return true; } })();
  if (!isAdminDevice()) return;
  if (framed) { adminNote("このページは、ほかのページの中に埋め込まれて開かれているので、年表の管理は出しません。歩みのページを、ブラウザのタブで直接開いてください。"); return; }
  import("./admin-history.js").then((m) => {
    adminApi = m.mountHistoryAdmin($("#histAdmin"), {
      repo: repoUrl(),
      sourceTexts: () => sourceTexts,
      loadArticles, // 記事から選ぶときの記事の一覧（公開している記事）
      // 直した内容で年表を作り直す（タブ・検索の言葉・スクロールの位置はそのまま）
      // setlistsText：年表の管理でセトリ（公演）を直したときは、行ったボタン・SET LIST の検索に使う公演も作り直す
      rebuild(historyText, sitesText, setlistsText) {
        if (setlistsText) { try { lives = parseSetlists(setlistsText).lives; assignKeys(lives); } catch { /* 前の公演のまま */ } }
        build(historyText, sitesText);
        shown = null;
        renderTabs({ center: false });
        renderTimeline();
        renderXref(); // 直したタグを、ほかのページで見つかったものにも映す
      }
    });
    shown = null;
    renderTimeline(); // 「直す」のボタンを出す
  }).catch((err) => {
    // 読み込めなくても、年表はそのまま見られる。管理者には理由を出す
    console.error(err);
    adminNote(`年表の管理を読み込めませんでした（${String((err && err.message) || err).slice(0, 200)}）。ページを読み込み直しても出ないときは、この文をそのまま作業担当に伝えてください。`);
  });
}

// 読み込み
(async () => {
  try {
    const res = await fetch("data/history.csv", { cache: "no-cache" });
    if (!res.ok) throw new Error();
    const historyText = await res.text();
    // 特設サイト（data/sites.csv）。読めなくても、年表はそのまま見られる
    let sitesText = "";
    try {
      const sr = await fetch("data/sites.csv", { cache: "no-cache" });
      if (sr.ok) sitesText = await sr.text();
    } catch { /* 特設サイトの印は出さない */ }
    // セトリのデータ（行ったライブの印のため）。読めなくても、年表はそのまま見られる
    let setlistsText = "";
    try {
      const sl = await fetch("data/setlists.csv", { cache: "no-cache" });
      if (sl.ok) { setlistsText = await sl.text(); lives = parseSetlists(setlistsText).lives; assignKeys(lives); }
    } catch { /* 印は出さない */ }
    sourceTexts = { history: historyText, sites: sitesText, setlists: setlistsText };
    build(historyText, sitesText);
    if (affiliateOn) $("#prNote").hidden = $("#prTop").hidden = false;
    // URL の ?q= で、検索した状態で開ける（楽曲一覧と同じ。例：history.html?q=ツアー）
    const q0 = new URLSearchParams(location.search).get("q");
    if (q0) { query = q0.slice(0, 100); searchBox.value = query; }
    // 読み込みの途中で検索窓に入れた言葉があれば、それを使う
    if (searchBox.value) query = searchBox.value;
    ready = true;
    setCat(location.hash.slice(1));
    renderXref(); // ?q= で開いたときは、ほかのページで見つかったものも出す
    setupAdmin();
    // 関連リンクに記事があれば、記事データを読んでから、もう一度並べる（タイトルと媒体を出すため）
    if (events.some((e) => e.links?.some((l) => l.type === "article"))) loadArticles().then(addLinkLines);
  } catch (err) {
    console.error(err);
    const box = $("#loading") || $("#timeline");
    if (box && !events.length) box.textContent = "年表を読み込めませんでした。時間をおいて、もう一度開いてください。";
  }
})();
addEventListener("hashchange", () => { if (ready && VIEWS.includes(location.hash.slice(1))) setCat(location.hash.slice(1)); });
