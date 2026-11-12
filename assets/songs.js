// assets/songs.js
// 「楽曲一覧」のページ（songs.html）の動き。曲のデータは data/songs.csv です（ここを書き換えると一覧が変わります）。
// ※ 歌詞には著作権があるので、歌詞の本文はこのサイトに載せません（データにも入れません）。
//   「歌詞を見る」は、歌詞の掲載を許諾されている歌詞サイト（歌ネット・UtaTen など）へのリンクです。
// ほかのデータともつなげています：
//   ・記事（data/articles.csv）…その曲にふれた記事の数を出し、押すと記事一覧を ?work=曲名 で開く
//   ・年表（data/history.csv）…「動画」の列にある、その曲の MV を YouTube で開く

import "./analytics.js";
import { parseSongs, parseArticles, parseHistory, SONG_KINDS } from "./data.js";
import { h as el, setupMenu, isAdminDevice } from "./ui.js";
import { feedbackUrl, hasFeedback, setupBeta, KIND } from "./feedback.js";

const $ = (s) => document.querySelector(s);

// 検索用に文字をそろえる（記事一覧の検索と同じ考え方：全角半角・大文字小文字・ひらがなとカタカナ・記号の違いをなくす）
const STRIP = /[\s　・、，,。．.／/「」『』【】〔〕［］[\]（）()<>＜＞〈〉《》\-‐–—―_~〜～!！?？:：;；'"“”‘’`*＊#＃|｜×✕+＋&＆]/g;
const norm = (s) => String(s || "").normalize("NFKC").toLowerCase()
  .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)).replace(STRIP, "");
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// 「すずめ feat.十明」→「すずめ」のように、記事を探すときの曲名（feat. より後ろを外す）
const baseTitle = (t) => t.replace(/\s*\(?\s*feat\..*$/i, "").trim();

// 歌ネット・UtaTen：曲ごとの歌詞のページの URL が「歌詞URL」の列にあればそこを開き、なければ、その歌詞サイトの中を曲名で探します
const LYRIC_SITES = [
  { name: "歌ネット", host: "uta-net.com" },
  { name: "UtaTen", host: "utaten.com" }
];
const siteSearch = (host, title) => `https://www.google.com/search?q=${encodeURIComponent(`site:${host} RADWIMPS ${title} 歌詞`)}`;
const youtube = (id) => `https://www.youtube.com/watch?v=${id}`;

const FILTERS = [{ slug: "all", name: "すべて" }, ...SONG_KINDS.map((k) => ({ slug: k, name: k })), { slug: "tieup", name: "タイアップ" }];
let songs = [], current = "all", query = "";

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
    return { ...s, base, articles: count(base), video: videos.get(norm(base)) || null,
      _h: norm([s.title, s.work, s.album, s.tieup, s.note, s.kind].join(" ")) };
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
  if (kind === "tieup" ? !s.tieup : kind !== "all" && s.kind !== kind) return false;
  return !q || s._h.includes(q);
}

function songItem(s) {
  const meta = el("p", { class: "song-meta" },
    el("time", { text: dateLabel(s) }),
    el("span", { class: "song-kind", text: s.kind }),
    s.work && s.work !== s.title ? el("span", { text: s.kind === "動画公開" ? s.work : `「${s.work}」` }) : null);
  const subs = [];
  if (s.album && s.album !== s.work) subs.push(el("p", { class: "song-sub", text: `アルバム「${s.album}」に収録` }));
  if (s.tieup) subs.push(el("p", { class: "song-sub song-tieup", text: s.tieup }));
  if (s.note) subs.push(el("p", { class: "song-sub", text: s.note }));

  const links = el("div", { class: "song-links" });
  if (s.lyrics) {
    links.append(el("a", { class: "song-btn song-lyrics", href: s.lyrics, target: "_blank", rel: "noopener noreferrer", text: "歌詞を見る ↗" }));
  } else {
    links.append(el("span", { class: "song-label", text: "歌詞を見る" }));
    for (const site of LYRIC_SITES) {
      links.append(el("a", { class: "song-btn song-lyrics", href: siteSearch(site.host, s.base), target: "_blank", rel: "noopener noreferrer",
        "aria-label": `「${s.title}」の歌詞を${site.name}で探す（新しいタブ）`, text: `${site.name} ↗` }));
    }
  }
  if (s.video) {
    const label = s.video.kind === "MV" ? "MV" : s.video.kind;
    links.append(el("a", { class: "song-btn", href: youtube(s.video.id), target: "_blank", rel: "noopener noreferrer", "aria-label": `「${s.title}」の${label}を YouTube で見る`, text: `▶ ${label}` }));
  }
  if (s.articles) {
    links.append(el("a", { class: "song-btn song-articles", href: `./?work=${encodeURIComponent(s.base)}&format=all`, text: `記事 ${s.articles}件` }));
  }
  return el("li", { class: "song-item" }, el("h3", { class: "song-title", text: s.title }), meta, ...subs, links);
}

function render() {
  const q = norm(query);
  const list = songs.filter((s) => match(s, current, q));
  const label = FILTERS.find((f) => f.slug === current).name;
  $("#songView").replaceChildren(el("b", { text: current === "all" ? "すべての曲" : label }), el("span", { text: `${list.length} 曲` }));
  const box = $("#songs");
  box.replaceChildren();
  if (!list.length) { box.append(el("p", { class: "hist-loading", text: "見つかりませんでした。言葉を変えて探してみてください。" })); return; }
  const years = new Map();
  for (const s of list) (years.get(s.y) || years.set(s.y, []).get(s.y)).push(s);
  for (const [y, items] of years) {
    box.append(el("section", { class: "hist-year", "aria-labelledby": `sy${y}` },
      el("h2", { id: `sy${y}`, class: "hist-year-head" }, el("span", { text: String(y) }), el("small", { text: `${items.length} 曲` })),
      el("ol", { class: "song-items" }, ...items.map(songItem))));
  }
}

$("#songKinds").addEventListener("click", (e) => {
  const b = e.target.closest("[data-kind]");
  if (!b) return;
  current = b.dataset.kind;
  for (const x of document.querySelectorAll("#songKinds [data-kind]")) x.setAttribute("aria-pressed", String(x === b));
  render();
});
let timer;
$("#songQ").addEventListener("input", (e) => { clearTimeout(timer); timer = setTimeout(() => { query = e.target.value; render(); }, 150); });

setupMenu();
setupBeta(document.querySelector("#main").firstElementChild);
if (hasFeedback) {
  document.querySelector(".site-footer .footer-links").append(
    el("a", { href: feedbackUrl({ kind: KIND.error, title: "楽曲一覧の誤りのお知らせ", page: "楽曲一覧" }), target: "_blank", rel: "noopener noreferrer", text: "一覧の誤りを知らせる ↗" }));
}
if (isAdminDevice()) document.getElementById("adminLink").hidden = false;

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
    render();
  } catch (e) {
    console.error(e);
    $("#songs").replaceChildren(el("p", { class: "hist-loading", text: "曲の一覧を読み込めませんでした。時間をおいて、もう一度開いてください。" }));
  }
})();
