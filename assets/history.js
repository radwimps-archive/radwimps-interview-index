// assets/history.js
// 「RADWIMPSの歩み」のページの動き。年表のデータは data/history.csv です（ここを書き換えると年表が変わります）。
// 上のタブでカテゴリを選ぶと、そのカテゴリの出来事だけが並びます（URL の末尾 #release などでも開けます）。
// 「MV」のタブ（#mv）は、MV のある曲だけを1曲ずつ並べます。
// 「ライブ・ツアー」の出来事には、行ったことのあるライブの印（ブックマーク）をつけられます。印は「RAD LIVE SET LIST」の公演日と同じもので、連動します（attended.js）。
//   どの出来事がどの公演か：data/setlists.csv の公演のうち、出来事の日付（期間）に入るもの。期間の中に別のライブ（フェスなど）があるときは、いちばん公演数の多いツアーだけ。

import "./analytics.js";
import { parseHistory, parseSetlists, HISTORY_CATEGORIES } from "./data.js";
import { attendButton, attendCount, assignKeys, sync as syncAttend, setupAttendClicks } from "./attended.js";
import { h as el, setupMenu, isAdminDevice } from "./ui.js";
import config from "./config.js";
import { feedbackUrl, hasFeedback, setupBeta, KIND } from "./feedback.js";

const $ = (s) => document.querySelector(s);

// カテゴリ（CSV に書く名前・URL の末尾・スマホのタブの短い名前）は、data.js の HISTORY_CATEGORIES で決めています
const CATS = HISTORY_CATEGORIES;
// 「MV」のタブ：「動画」の列で「MV」から始まるラベルの動画を、1曲ずつの行にして並べる（CSV に書く必要はありません）
const MV_TAB = { name: "MV", slug: "mv", short: "MV" };
const VIEWS = ["all", ...CATS.map((c) => c.slug), MV_TAB.slug];
// 年代へ移動するリンク（参考：年代ごとの区切り）
const ERAS = [[2001, 2008], [2009, 2016], [2017, 9999]];

let events = [];
let lives = [];   // セトリのデータ（data/setlists.csv）の公演。読めないときは空（印は出ません）
let current = "all";

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
const isoOf = (y, m, d) => `${y}-${pad(m || 1)}-${pad(d || 1)}`;
function showsOf(e) {
  if (!e.m || !e.cats.some((c) => c.name === "ライブ・ツアー")) return [];
  const from = isoOf(e.y, e.m, e.d);
  const to = e.ey ? isoOf(e.ey, e.em || 12, e.ed || 31) : e.d ? from : isoOf(e.y, e.m, 31);
  const inside = lives.filter((l) => { const k = isoOf(l.y, l.m, l.d); return k >= from && k <= to; });
  if (!e.ey) return inside;
  // 期間の中にフェスなど別のライブがあるときは、公演がいちばん多いツアー（同じなら早いほう）だけにする
  const by = new Map();
  for (const l of inside) (by.get(l.name) || by.set(l.name, []).get(l.name)).push(l);
  return [...by.values()].sort((a, b) => b.length - a.length)[0] || [];
}
// 出来事の下の「行った」ボタン。1公演だけならボタン、複数ならたたんだ欄に公演日を並べる
function attendLine(e) {
  const shows = e.shows;
  if (!shows || !shows.length) return null;
  if (shows.length === 1) return el("p", { class: "att-line" }, attendButton(shows[0]));
  const sameYear = shows.every((l) => l.y === shows[0].y);
  const chips = el("div", { class: "att-chips" }, ...shows.map((l) => attendButton(l, { label: `${sameYear ? "" : `${l.y}.`}${pad(l.m)}.${pad(l.d)} ${(l.venue || "").replace(/（.*）$/, "")}`.trim() })));
  return el("details", { class: "att-shows" }, el("summary", {}, "行った公演を選ぶ", attendCount(shows)), chips);
}

function renderTabs() {
  const tabs = $("#tabs");
  tabs.replaceChildren();
  tabs.className = `hist-tabs wrap cat-${current}`; // 下の細い線の色は、選んでいるカテゴリの色
  const all = [{ name: "すべて", slug: "all", short: "すべて" }, ...CATS, MV_TAB];
  for (const t of all) {
    const n = t.slug === "all" ? events.length : t.slug === "mv" ? mvSongs().length : events.filter((e) => e.cats.some((c) => c.slug === t.slug)).length;
    const b = el("button", { type: "button", role: "tab", class: `hist-tab cat-${t.slug}`, "aria-selected": String(t.slug === current), "data-cat": t.slug, "aria-label": `${t.name} ${n}件` },
      el("span", { class: "lbl-full", text: t.name }), el("span", { class: "lbl-short", text: t.short, "aria-hidden": "true" }), el("small", { text: String(n) }));
    tabs.append(b);
  }
  // 入りきらないときは、選んでいるタブが見えるところまで横にスクロールする
  const on = tabs.querySelector('[aria-selected="true"]');
  if (on) tabs.scrollTo({ left: on.offsetLeft - (tabs.clientWidth - on.offsetWidth) / 2, behavior: "auto" });
}

function renderTimeline() {
  const box = $("#timeline");
  const list = current === "all" ? events : current === "mv" ? mvSongs() : events.filter((e) => e.cats.some((c) => c.slug === current));
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
      ol.append(el("li", { class: `hist-item cat-${dot(e).slug}` },
        el("p", { class: "hist-meta" },
          e.m ? el("time", { text: dateLabel(e) }) : null,
          ...(e.cats || [e.cat]).map((c) => el("span", { class: `hist-cat cat-${c.slug}`, text: c.name }))),
        ...titleLine(e),
        e.note ? el("p", { class: "hist-sub", text: e.note }) : null,
        attendLine(e),
        videoLine(e)));
    }
    sec.append(ol);
    box.append(sec);
  }
  if (!list.length) box.append(el("p", { class: "hist-loading", text: current === "mv" ? "MV はまだありません。" : "このカテゴリの出来事はまだありません。" }));
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
    cats: [tag, ...e.cats.filter((c) => c.person)], title: `「${name}」`, note: e.title, i: e.i * 100 + j,
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

// 年代へ移動するリンク（表示中の出来事がある年代だけ押せる）
function renderEras(list) {
  const nav = $("#eras");
  nav.replaceChildren();
  const last = events.length ? events[events.length - 1].y : 2026;
  for (const [a, b] of ERAS) {
    const to = Math.min(b, last);
    const first = list.find((e) => e.y >= a && e.y <= to);
    const label = `${a}–${to}`;
    nav.append(first
      ? el("a", { href: `#y${first.y}`, "data-year": String(first.y), text: label })
      : el("span", { class: "off", text: label }));
  }
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

const tapIsAccident = () => tap.touch && (tap.moved || tap.scrolling);
$("#timeline").addEventListener("click", (e) => {
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
// 年代リンク：上の帯とタブに隠れない位置へ
$("#eras").addEventListener("click", (e) => {
  const a = e.target.closest("a[data-year]");
  if (!a) return;
  e.preventDefault();
  const t = document.getElementById(`y${a.dataset.year}`);
  scrollTo({ top: t.getBoundingClientRect().top + scrollY - headerH() - $(".hist-tabs-bar").offsetHeight - 8, behavior: "smooth" });
});

// いちばん上へ戻るボタン
const toTop = $("#toTop");
addEventListener("scroll", () => { toTop.hidden = scrollY < 900; }, { passive: true });
toTop.addEventListener("click", () => scrollTo({ top: 0, behavior: "smooth" }));

// 「行った」ボタン
setupAttendClicks();
// メニュー（記事一覧のページと同じ動き。ui.js）
setupMenu();
setupBeta($("#main").firstElementChild);
// フッターの「誤りを知らせる」（受付先は feedback.js で決まります）
if (hasFeedback) {
  $(".site-footer .footer-links").append(el("a", { href: feedbackUrl({ kind: KIND.error, title: "年表の誤りのお知らせ", page: "RADWIMPSの歩み（年表）" }), target: "_blank", rel: "noopener noreferrer", text: "年表の誤りを知らせる ↗" }));
}
if (isAdminDevice()) $("#adminLink").hidden = false;

// 読み込み
(async () => {
  try {
    const res = await fetch("data/history.csv", { cache: "no-cache" });
    if (!res.ok) throw new Error();
    events = load(await res.text());
    // セトリのデータ（行ったライブの印のため）。読めなくても、年表はそのまま見られる
    try {
      const sl = await fetch("data/setlists.csv", { cache: "no-cache" });
      if (sl.ok) { lives = parseSetlists(await sl.text()).lives; assignKeys(lives); }
    } catch { /* 印は出さない */ }
    for (const e of events) e.shows = showsOf(e);
    if (events.length) $("#span").textContent = `${events[0].y} — ${events[events.length - 1].y}`;
    if (affiliateOn) $("#prNote").hidden = $("#prTop").hidden = false;
    setCat(location.hash.slice(1));
  } catch {
    $("#loading").textContent = "年表を読み込めませんでした。時間をおいて、もう一度開いてください。";
  }
})();
addEventListener("hashchange", () => { if (VIEWS.includes(location.hash.slice(1))) setCat(location.hash.slice(1)); });
