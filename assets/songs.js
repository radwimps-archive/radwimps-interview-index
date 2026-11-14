// assets/songs.js
// 「楽曲一覧」のページ（songs.html）の動き。曲のデータは data/songs.csv です（ここを書き換えると一覧が変わります）。
// ※ 歌詞には著作権があるので、歌詞の本文はこのサイトに載せません（データにも入れません）。
//   「歌詞」は、歌詞の掲載を許諾されている歌詞サイト（プチリリ）へのリンクです。
// ほかのデータともつなげています：
//   ・記事（data/articles.csv）…その曲にふれた記事の数を出し、押すと記事一覧を ?work=曲名 で開く
//   ・年表（data/history.csv）…「動画」の列にある、その曲の MV を YouTube で開く

import "./analytics.js";
import { parseSongs, parseArticles, parseHistory, SONG_KINDS } from "./data.js";
import { h as el, setupMenu, isAdminDevice } from "./ui.js";
import { feedbackUrl, hasFeedback, setupBeta, KIND } from "./feedback.js";
import config from "./config.js";

const $ = (s) => document.querySelector(s);

// 検索用に文字をそろえる（記事一覧の検索と同じ考え方：全角半角・大文字小文字・ひらがなとカタカナ・記号の違いをなくす）
const STRIP = /[\s　・、，,。．.／/「」『』【】〔〕［］[\]（）()<>＜＞〈〉《》\-‐–—―_~〜～!！?？:：;；'"“”‘’`*＊#＃|｜×✕+＋&＆]/g;
const norm = (s) => String(s || "").normalize("NFKC").toLowerCase()
  .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)).replace(STRIP, "");
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// 「すずめ feat.十明」→「すずめ」のように、記事を探すときの曲名（feat. より後ろを外す）
const baseTitle = (t) => t.replace(/\s*\(?\s*feat\..*$/i, "").trim();

// プチリリ：曲ごとの歌詞のページの URL が「歌詞URL」の列にあればそこを開き、なければ、プチリリの中を「曲名・RADWIMPS」で探した結果を開きます
const LYRIC_SITES = [
  { name: "プチリリ", host: "petitlyrics.com", search: (title) => `https://petitlyrics.com/search_lyrics?title=${encodeURIComponent(title)}&artist=RADWIMPS` }
];
// 「聴く」：配信の曲は、音楽サブスクリプションの検索結果を開きます（曲ごとのページの URL がなくても、曲名と RADWIMPS で見つかります）
const q = (...w) => encodeURIComponent(["RADWIMPS", ...w].join(" "));
// 歌詞のリンクを「新しいタブ」で開くか「このタブ」で開くか（ページ上の切り替えで選び、この端末に覚えておきます）
const STORE_OPEN = "radwimps-interview-index:lyric-open";
let lyricOpen = "new";
try { if (localStorage.getItem(STORE_OPEN) === "same") lyricOpen = "same"; } catch { /* 保存できない端末では毎回「新しいタブ」 */ }
function applyOpen(a) {
  const same = lyricOpen === "same";
  if (same) a.removeAttribute("target"); else a.setAttribute("target", "_blank");
  a.setAttribute("aria-label", `${a.dataset.label}（${same ? "このタブ" : "新しいタブ"}で開く）`);
}
function lyricLink(href, label, text) {
  const a = el("a", { class: "song-btn song-lyrics", href, rel: "noopener noreferrer", "data-label": label, text });
  applyOpen(a);
  return a;
}
function setOpen(v) {
  lyricOpen = v === "same" ? "same" : "new";
  try { localStorage.setItem(STORE_OPEN, lyricOpen); } catch { /* 覚えられなくても、このページを開いている間は効きます */ }
  for (const b of document.querySelectorAll(".song-open-btn")) b.setAttribute("aria-pressed", String(b.dataset.open === lyricOpen));
  for (const a of document.querySelectorAll("a.song-lyrics")) applyOpen(a);
}

const LISTEN = [
  { name: "Spotify", url: (t) => `https://open.spotify.com/search/${q(t)}` },
  { name: "Apple Music", url: (t) => `https://music.apple.com/jp/search?term=${q(t)}` },
  { name: "YouTube Music", url: (t) => `https://music.youtube.com/search?q=${q(t)}` }
];
// 「買う」：CD の作品は、通販サイトの検索結果を開きます。
//   タワーレコードは、config.js の towerAffiliate（バリューコマースの sid・pid）を書くとアフィリエイトリンクになり、「PR」が出ます（年表と同じ）。
//   Amazon は config.js の amazonTag（Amazon アソシエイトのトラッキング ID）を書くとアフィリエイトリンクになります。楽天は今はふつうのリンクです。
const AFF = config.towerAffiliate || {};
const towerAff = !!(AFF.sid && AFF.pid);
const amazonTag = /^[\w-]+-22$/.test(config.amazonTag || "") ? config.amazonTag : "";
const BUY = [
  { name: "タワレコ", aff: towerAff, url: (w) => {
    const plain = `https://tower.jp/search/item/${q(w)}`;
    return towerAff ? `https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=${encodeURIComponent(AFF.sid)}&pid=${encodeURIComponent(AFF.pid)}&vc_url=${encodeURIComponent(plain)}` : plain;
  } },
  { name: "Amazon", aff: !!amazonTag, url: (w) => `https://www.amazon.co.jp/s?k=${q(w)}&i=music${amazonTag ? `&tag=${amazonTag}` : ""}` },
  { name: "楽天", aff: false, url: (w) => `https://search.rakuten.co.jp/search/mall/${q(w)}/` }
];
// CD で買える作品の名前：CD で出た曲は初めて出た作品、配信の曲は、あとで入ったアルバム（なければ買うリンクは出さない）
const CD_KINDS = ["シングル", "アルバム", "サウンドトラック"];
const youtube = (id) => `https://www.youtube.com/watch?v=${id}`;

// 絞り込み：「シングル」には、CD のシングルと配信のシングル（データの種類が「配信」）の両方が入ります
const SINGLE_KINDS = ["シングル", "配信"];
const FILTERS = [{ slug: "all", name: "すべて" }, ...SONG_KINDS.filter((k) => k !== "配信").map((k) => ({ slug: k, name: k })), { slug: "tieup", name: "タイアップ" }];
// 曲の札に出す名前（「配信」は「配信シングル」と出す）
const kindLabel = (k) => (k === "配信" ? "配信シングル" : k);
let songs = [], current = "all", query = "", order = "date";

// 50音順：「読み」の列（なければ曲名）を、ひらがなにそろえて並べます。英語や数字で始まる曲は、最後の「英数字」にまとめます
const ROWS = [["あ", "ぁ", "お"], ["か", "か", "ご"], ["さ", "さ", "ぞ"], ["た", "た", "ど"], ["な", "な", "の"], ["は", "は", "ぽ"],
  ["ま", "ま", "も"], ["や", "ゃ", "よ"], ["ら", "ら", "ろ"], ["わ", "ゎ", "ん"]];
const ABC = "英数字";
const kanaKey = (s) => String(s || "").normalize("NFKC").toLowerCase()
  .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/ゔ/g, "う").replace(STRIP, "");
function rowOf(key) {
  const c = key[0] || "";
  const r = ROWS.find(([, a, b]) => c >= a && c <= b);
  return r ? `${r[0]}行` : ABC;
}

const pad = (n) => String(n).padStart(2, "0");
const dateLabel = (s) => `${s.y}${s.m ? "." + pad(s.m) : ""}${s.d ? "." + pad(s.d) : ""}`;

// 記事の数：記事一覧の「曲・作品から探す」（?work=）と同じ決まりで数えます
function articleCounter(items) {
  const list = items.filter((it) => it.state === "公開").map((it) => ({
    title: it.title, summary: it.summary, tags: new Set(it.tags.map(norm)), w: norm([it.title, it.summary, it.tags.join(" "), it.eventName].join(" "))
  }));
  return (name) => {
    const n = norm(name);
    if (!n) return 0;
    const quoted = new RegExp(`[「『“"]${reEsc(name)}[」』”"]`);
    return list.filter((it) => it.tags.has(n) || quoted.test(it.title) || quoted.test(it.summary) || ([...n].length >= 4 && it.w.includes(n))).length;
  };
}

// 年表の「動画」の列から、曲名 → MV の動画（ラベルが「MV」で始まるもの。MV がなければリリックビデオ・ライブ映像）
function videoMap(events) {
  const map = new Map();
  const rank = (label) => (/^MV/.test(label) ? 0 : /^リリックビデオ/.test(label) ? 1 : 2);
  for (const e of events) {
    for (const v of e.videos) {
      const name = (v.label.match(/「(.+?)」/) || e.title.match(/「(.+?)」/) || [])[1];
      if (!name || !/^(MV|リリックビデオ|ライブ映像|スタジオライブ)/.test(v.label)) continue;
      const key = norm(baseTitle(name.replace(/\s*\[.*?\]|\s*\((?:movie|original).*?\)/gi, "")));
      const kind = v.label.replace(/「.*$/, "").trim() || "MV";
      const old = map.get(key);
      if (!old || rank(kind) < rank(old.kind)) map.set(key, { id: v.id, kind });
    }
  }
  return map;
}

function load(songText, articleText, historyText) {
  const parsed = parseSongs(songText);
  if (parsed.errors.length) console.warn("楽曲のデータに、直すところがあります", parsed.errors);
  const count = articleText ? articleCounter(parseArticles(articleText).items) : () => 0;
  const videos = historyText ? videoMap(parseHistory(historyText).events) : new Map();
  return parsed.songs.map((s) => {
    const base = baseTitle(s.title);
    const sortKey = kanaKey(s.yomi || base);
    return { ...s, base, sortKey, row: rowOf(sortKey), articles: count(base), video: videos.get(norm(base)) || null,
      _h: norm([s.title, s.work, s.album, s.tieup, s.note, kindLabel(s.kind)].join(" ")) };
  });
}

function renderFilters() {
  const box = $("#songKinds");
  box.replaceChildren();
  for (const f of FILTERS) {
    const n = songs.filter((s) => match(s, f.slug, "")).length;
    if (!n) continue;
    box.append(el("button", { type: "button", class: "hist-tab", "aria-pressed": String(f.slug === current), "data-kind": f.slug, "aria-label": `${f.name} ${n}曲` },
      el("span", { text: f.name }), el("small", { text: String(n) })));
  }
}

function match(s, kind, q) {
  const ok = kind === "all" || (kind === "tieup" ? !!s.tieup : kind === "シングル" ? SINGLE_KINDS.includes(s.kind) : s.kind === kind);
  if (!ok) return false;
  return !q || s._h.includes(q);
}

function songItem(s, inRelease) {
  // 発売順では、日付と作品名は「発売ごとの見出し」に出すので、曲の行には種類の札だけ。50音順では今までどおり日付・作品名も出す
  // （種類の札も、発売順では作品名の隣に1つだけ出す）
  const cdBuy = !inRelease && CD_KINDS.includes(s.kind) && s.work ? buyPanel(s.work) : null;
  const meta = inRelease ? null : el("p", { class: "song-meta" },
    el("time", { text: dateLabel(s) }),
    el("span", { class: "song-kind", text: kindLabel(s.kind) }),
    s.work && s.work !== s.title ? (cdBuy ? workBtn(`「${s.work}」`, cdBuy) : el("span", { text: s.kind === "動画公開" ? s.work : `「${s.work}」` })) : null);
  const subs = [];
  if (s.album && s.album !== s.work) subs.push(el("p", { class: "song-sub", text: `アルバム「${s.album}」に収録` }));
  if (s.tieup) subs.push(el("p", { class: "song-sub song-tieup", text: s.tieup }));
  if (s.note) subs.push(el("p", { class: "song-sub", text: s.note }));

  const links = el("div", { class: "song-links song-panel", id: `lyr${++uid}`, hidden: true });
  const after = [];
  // 歌のない曲（「メモ」が「インスト」「スキット」で始まる曲）と、歌詞を載せない曲（「歌詞非公開」で始まる曲）には、「歌詞」を出さない
  if (/^(インスト|スキット|歌詞非公開)/.test(s.note)) {
    // 何も出さない
  } else if (s.lyrics) {
    // 「歌詞URL」に曲のページがあるときは、そのページを直接開く（ボタンは「歌詞」だけ）
    const host = new URL(s.lyrics).hostname.replace(/^www\./, "");
    const site = LYRIC_SITES.find((x) => x.host === host);
    links.append(lyricLink(s.lyrics, `「${s.title}」の歌詞を${site ? site.name : "歌詞サイト"}で見る`, "歌詞 ↗"));
  } else {
    // 曲のページがないときは、歌詞サイトの中を曲名で探した結果を開く
    for (const site of LYRIC_SITES) {
      links.append(lyricLink(site.search(s.base), `「${s.title}」の歌詞を${site.name}で探す`, "歌詞 ↗"));
    }
  }
  if (s.video) {
    const label = s.video.kind === "MV" ? "MV" : s.video.kind;
    links.append(el("a", { class: "song-btn", href: youtube(s.video.id), target: "_blank", rel: "noopener noreferrer", "aria-label": `「${s.title}」の${label}を YouTube で見る`, text: `▶ ${label}` }));
  }
  // 聴く（配信の曲）・買う（CD の作品）
  if (s.kind === "配信") {
    after.push(el("div", { class: "song-links song-shops" }, el("span", { class: "song-label", text: "聴く" }),
      ...LISTEN.map((m) => el("a", { class: "song-btn song-shop", href: m.url(s.base), target: "_blank", rel: "noopener noreferrer", "aria-label": `「${s.title}」を${m.name}で聴く（新しいタブ）`, text: `${m.name} ↗` }))));
  }
  // 曲名を押すと、「歌詞」「MV・ライブ映像」が曲名の下に開きます。「記事」は曲名の隣に出したままです
  let title = el("h3", { class: "song-title", text: s.title }), panel = null;
  if (links.children.length) {
    panel = links;
    title = el("h3", { class: "song-title" }, el("button", { type: "button", class: "song-title-btn", "aria-expanded": "false", "aria-controls": links.id, title: "押すと、歌詞などが開きます" }, s.title));
  }
  const art = s.articles ? el("a", { class: "song-btn song-articles", href: `./?work=${encodeURIComponent(s.base)}&format=all`, text: `記事 ${s.articles}件` }) : null;
  return el("li", { class: "song-item" }, el("div", { class: "song-head" }, title, art), panel, meta, cdBuy, ...subs, ...after);
}
// 作品名（アルバム名・シングル名）を押すと開く「CD を探す」（タワレコ・Amazon・楽天）
function buyPanel(work) {
  const plainWork = work.replace(/[〜~].*$/, "").trim() || work; // 「RADWIMPS 4〜おかずのごはん〜」→「RADWIMPS 4」で探す（長いと見つからないため）
  return el("div", { class: "song-links song-buy", id: `buy${++uid}`, hidden: true }, el("span", { class: "song-label", text: "CD を探す" }),
    ...BUY.map((m) => el("a", { class: "song-btn song-shop", href: m.url(plainWork), target: "_blank", rel: m.aff ? "sponsored noopener noreferrer" : "noopener noreferrer",
      "aria-label": `「${work}」の CD を${m.name}で探す（新しいタブ）`, text: `${m.name} ↗` }, m.aff ? el("span", { class: "pr", text: "PR" }) : null)));
}
function workBtn(text, panel) {
  return el("button", { type: "button", class: "song-work-btn", "aria-expanded": "false", "aria-controls": panel.id, title: "押すと、CD を探すリンクが開きます" }, text);
}
let uid = 0;
let folded = false; // 「すべて閉じる」を選んだあとは、作品の曲を閉じた状態で並べる

function render() {
  const q = norm(query);
  const list = songs.filter((s) => match(s, current, q));
  const label = FILTERS.find((f) => f.slug === current).name;
  $("#songView").replaceChildren(el("b", { text: current === "all" ? "すべての曲" : label }), el("span", { text: `${list.length} 曲` }));
  const box = $("#songs");
  box.replaceChildren();
  if (!list.length) { box.append(el("p", { class: "hist-loading", text: "見つかりませんでした。言葉を変えて探してみてください。" })); return; }
  // 発売順は年ごと、50音順は「あ行」「か行」…「英数字」ごとにまとめる
  const kana = order === "kana";
  $("#songFold").hidden = kana; // 曲の開閉は、発売順（作品ごとの見出しがあるとき）だけ
  const sorted = kana ? [...list].sort((a, b) => (a.row === ABC) - (b.row === ABC) || a.sortKey.localeCompare(b.sortKey, "ja") || a.title.localeCompare(b.title, "ja")) : list;
  if (kana) {
    const groups = new Map();
    for (const s of sorted) (groups.get(s.row) || groups.set(s.row, []).get(s.row)).push(s);
    let n = 0;
    for (const [g, items] of groups) {
      const id = `sg${n++}`;
      box.append(el("section", { class: "hist-year song-row", "aria-labelledby": id },
        el("h2", { id, class: "hist-year-head" }, el("span", { text: String(g) }), el("small", { text: `${items.length} 曲` })),
        el("ol", { class: "song-items" }, ...items.map((x) => songItem(x, false)))));
    }
    return;
  }
  // 発売順：「RADWIMPSの歩み」と同じく、年の見出しは1回だけ。年の中に、作品（アルバム・シングル）ごとの項目を、日付つきで並べる
  // （同じ作品・同じ日の曲は、ひとつの項目にまとめる）
  const years = new Map();
  for (const s of sorted) {
    const rel = years.get(s.y) || years.set(s.y, new Map()).get(s.y);
    const k = `${s.m || 0}|${s.d || 0}|${s.work || s.title}`;
    (rel.get(k) || rel.set(k, []).get(k)).push(s);
  }
  const shut = folded && !q; // 検索中は、見つかった曲を隠さない
  for (const [y, rels] of years) {
    const id = `sy${y}`;
    const total = [...rels.values()].reduce((a, v) => a + v.length, 0);
    const ol = el("ol", { class: "hist-list song-releases" });
    for (const items of rels.values()) {
      const f = items[0];
      const olId = `ol${++uid}`;
      const work = f.work || f.title;
      const cdBuy = CD_KINDS.includes(f.kind) ? buyPanel(work) : null;
      ol.append(el("li", { class: "hist-item song-release" },
        el("p", { class: "hist-meta" }, el("time", { text: dateLabel(f) }),
          el("button", { type: "button", class: "song-fold-btn", "aria-expanded": String(!shut), "aria-controls": olId, title: "押すと、この作品の曲を開く・閉じる" }, `${items.length} 曲`)),
        el("p", { class: "song-release-work" }, cdBuy ? workBtn(work, cdBuy) : el("span", { text: work }), el("span", { class: "song-kind", text: kindLabel(f.kind) })),
        cdBuy,
        el("ol", { class: "song-items", id: olId, hidden: shut }, ...items.map((x) => songItem(x, true)))));
    }
    box.append(el("section", { class: "hist-year", id, "aria-labelledby": `${id}h` },
      el("h2", { id: `${id}h`, class: "hist-year-head" }, el("span", { text: String(y) }), el("small", { text: `${total} 曲` })),
      ol));
  }
}

$("#songKinds").addEventListener("click", (e) => {
  const b = e.target.closest("[data-kind]");
  if (!b) return;
  current = b.dataset.kind;
  for (const x of document.querySelectorAll("#songKinds [data-kind]")) x.setAttribute("aria-pressed", String(x === b));
  render();
  backToList();
});
// 並び順（発売順・50音順）。URL の ?sort=kana で、50音順で開けます
function setOrder(o) {
  order = o === "kana" ? "kana" : "date";
  for (const b of document.querySelectorAll("#songOrder [data-order]")) b.setAttribute("aria-pressed", String(b.dataset.order === order));
  const u = new URL(location.href);
  if (order === "kana") u.searchParams.set("sort", "kana"); else u.searchParams.delete("sort");
  try { history.replaceState(null, "", u.pathname + u.search + u.hash); } catch { /* 変えられない環境 */ }
  render();
  backToList();
}
// 並び替え・絞り込みをしたとき、一覧の途中まで下りていたら、一覧のはじめに戻す（帯に隠れない位置）
function backToList() {
  const box = $("#songView");
  const top = box.getBoundingClientRect().top + scrollY - 60 - bar.offsetHeight;
  if (scrollY > top) scrollTo({ top });
}
$("#songOpen").addEventListener("click", (e) => { const b = e.target.closest("[data-open]"); if (b) setOpen(b.dataset.open); });
setOpen(lyricOpen);
// 曲の開閉：作品ごと（件数のボタン）と、すべて（「曲の一覧」の2つのボタン）
function setFolded(shut, btn) {
  if (btn) { // 作品ひとつだけ
    btn.setAttribute("aria-expanded", String(!shut));
    const ol = document.getElementById(btn.getAttribute("aria-controls"));
    if (ol) ol.hidden = shut;
    return;
  }
  folded = shut;
  for (const b of document.querySelectorAll(".song-fold-btn")) {
    b.setAttribute("aria-expanded", String(!shut));
    const ol = document.getElementById(b.getAttribute("aria-controls"));
    if (ol) ol.hidden = shut;
  }
  for (const b of document.querySelectorAll("#songFold [data-fold]")) b.setAttribute("aria-pressed", String((b.dataset.fold === "shut") === shut));
}
$("#songFold").addEventListener("click", (e) => { const b = e.target.closest("[data-fold]"); if (b) setFolded(b.dataset.fold === "shut"); });
// 曲名を押すと、購入リンクを開く・閉じる
$("#songs").addEventListener("click", (e) => {
  const fb = e.target.closest(".song-fold-btn");
  if (fb) { setFolded(fb.getAttribute("aria-expanded") === "true", fb); return; }
  const b = e.target.closest(".song-title-btn, .song-work-btn");
  if (!b) return;
  const panel = document.getElementById(b.getAttribute("aria-controls"));
  const open = b.getAttribute("aria-expanded") !== "true";
  b.setAttribute("aria-expanded", String(open));
  if (panel) panel.hidden = !open;
});
$("#songOrder").addEventListener("click",(e) => { const b = e.target.closest("[data-order]"); if (b) setOrder(b.dataset.order); });
let timer;
$("#songQ").addEventListener("input", (e) => { clearTimeout(timer); timer = setTimeout(() => { query = e.target.value; render(); backToList(); }, 150); });

// 検索と並び順の帯：スクロールして上に張りついたら、少し小さくする
const bar = $("#songBar");
if ("IntersectionObserver" in window) {
  new IntersectionObserver(([x]) => bar.classList.toggle("stuck", !x.isIntersecting), { rootMargin: `-${60 + 1}px 0px 0px 0px` }).observe($("#songSentinel"));
}
// いちばん上へ戻るボタン：下へスクロールを始めたら出す
const toTop = $("#toTop");
addEventListener("scroll", () => { toTop.hidden = scrollY < 200; }, { passive: true });
toTop.addEventListener("click", () => {
  scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  $("#songQ").blur();
});

setupMenu();
setupBeta(document.querySelector("#main").firstElementChild);
if (hasFeedback) {
  document.querySelector(".site-footer .footer-links").append(
    el("a", { href: feedbackUrl({ kind: KIND.error, title: "楽曲一覧の誤りのお知らせ", page: "楽曲一覧" }), target: "_blank", rel: "noopener noreferrer", text: "一覧の誤りを知らせる ↗" }));
}
if (isAdminDevice()) document.getElementById("adminLink").hidden = false;
// アフィリエイト（広告）のリンクがあるときは、ページの上下にそのことを出す（ステマ規制・提携の条件）
if (BUY.some((m) => m.aff)) { $("#prTop").hidden = false; $("#prNote").hidden = false; }

(async () => {
  try {
    const get = (f) => fetch(f, { cache: "no-cache" }).then((r) => (r.ok ? r.text() : "")).catch(() => "");
    const [songText, articleText, historyText] = await Promise.all([get("data/songs.csv"), get("data/articles.csv"), get("data/history.csv")]);
    if (!songText) throw new Error("songs.csv を読めませんでした");
    songs = load(songText, articleText, historyText);
    $("#songCount").textContent = `${songs.length}`;
    const p = new URLSearchParams(location.search);
    if (p.get("q")) { query = p.get("q").slice(0, 100); $("#songQ").value = query; }
    renderFilters();
    setOrder(p.get("sort"));
  } catch (e) {
    console.error(e);
    $("#songs").replaceChildren(el("p", { class: "hist-loading", text: "曲の一覧を読み込めませんでした。時間をおいて、もう一度開いてください。" }));
  }
})();
