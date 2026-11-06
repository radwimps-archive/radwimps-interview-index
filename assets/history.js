// assets/history.js
// 「RADWIMPSの歩み」のページの動き。年表のデータは data/history.csv です（ここを書き換えると年表が変わります）。
// 上のタブでカテゴリを選ぶと、そのカテゴリの出来事だけが並びます（URL の末尾 #release などでも開けます）。
// 「MV」のタブ（#mv）は、MV のある曲だけを1曲ずつ並べます。

import { parseCSV } from "./data.js";
import config from "./config.js";

const $ = (s) => document.querySelector(s);

// カテゴリ：CSV に書く名前、URL の末尾（#…）、スマホのタブに出す短い名前
const CATS = [
  { name: "リリース", slug: "release", short: "リリース" },
  { name: "ライブ・ツアー", slug: "live", short: "ライブ" },
  { name: "映画・タイアップ", slug: "tieup", short: "タイアップ" },
  { name: "バンドの出来事", slug: "band", short: "出来事" }
];
// 「MV」のタブ：「動画」の列で「MV」から始まるラベルの動画を、1曲ずつの行にして並べる（CSV に書く必要はありません）
const MV_TAB = { name: "MV", slug: "mv", short: "MV" };
const VIEWS = ["all", ...CATS.map((c) => c.slug), MV_TAB.slug];
// 年代へ移動するリンク（参考：年代ごとの区切り）
const ERAS = [[2001, 2008], [2009, 2016], [2017, 9999]];

let events = [];
let current = "all";

const pad = (n) => String(n).padStart(2, "0");
function dateLabel(e) {
  const one = (m, d) => (m ? (d ? `${pad(m)}.${pad(d)}` : `${pad(m)}月`) : "");
  const start = one(e.m, e.d);
  if (!e.ey) return start;
  const end = (e.ey !== e.y ? `${e.ey}.` : "") + one(e.em, e.ed);
  return `${start} – ${end}`;
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "text") n.textContent = v; else n.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) n.append(k);
  return n;
}

function load(text) {
  const { rows } = parseCSV(text);
  const head = rows[0].map((h) => h.trim());
  const at = (name) => head.indexOf(name);
  const c = { y: at("年"), m: at("月"), d: at("日"), ey: at("終了年"), em: at("終了月"), ed: at("終了日"), cat: at("カテゴリ"), title: at("出来事"), note: at("補足"),
    site: at("特設サイト"), tower: at("タワーレコード"), video: at("動画") };
  const num = (v) => (v && /^\d+$/.test(v.trim()) ? +v : 0);
  const url = (v) => (v && /^https:\/\/[^\s"<>]+$/.test(v.trim()) ? v.trim() : ""); // https で始まるリンクだけ使う
  const cell = (r, i) => (i < 0 ? "" : (r[i] || "").trim());
  return rows.slice(1).filter((r) => r.some((x) => x.trim())).map((r, i) => ({
    y: num(r[c.y]), m: num(r[c.m]), d: num(r[c.d]),
    ey: num(r[c.ey]), em: num(r[c.em]), ed: num(r[c.ed]),
    cat: CATS.find((k) => k.name === (r[c.cat] || "").trim()) || CATS[3],
    title: (r[c.title] || "").trim(), note: (r[c.note] || "").trim(), i,
    site: url(cell(r, c.site)), tower: towerUrl(cell(r, c.tower)), videos: videoList(cell(r, c.video))
  })).filter((e) => e.y && e.title)
    // 古い順（同じ日は CSV に書いた順）。月・日がないものは、その年・その月のはじめに
    .sort((a, b) => a.y - b.y || a.m - b.m || a.d - b.d || a.i - b.i);
}

function renderTabs() {
  const tabs = $("#tabs");
  tabs.replaceChildren();
  const all = [{ name: "すべて", slug: "all", short: "すべて" }, ...CATS, MV_TAB];
  for (const t of all) {
    const n = t.slug === "all" ? events.length : t.slug === "mv" ? mvSongs().length : events.filter((e) => e.cat.slug === t.slug).length;
    const b = el("button", { type: "button", role: "tab", class: `hist-tab cat-${t.slug}`, "aria-selected": String(t.slug === current), "data-cat": t.slug, "aria-label": `${t.name} ${n}件` },
      el("span", { class: "lbl-full", text: t.name }), el("span", { class: "lbl-short", text: t.short, "aria-hidden": "true" }), el("small", { text: String(n) }));
    tabs.append(b);
  }
}

function renderTimeline() {
  const box = $("#timeline");
  const list = current === "all" ? events : current === "mv" ? mvSongs() : events.filter((e) => e.cat.slug === current);
  const years = new Map();
  for (const e of list) (years.get(e.y) || years.set(e.y, []).get(e.y)).push(e);
  box.replaceChildren();
  for (const [y, items] of years) {
    const sec = el("section", { class: "hist-year", id: `y${y}`, "aria-labelledby": `yh${y}` },
      el("h2", { id: `yh${y}`, class: "hist-year-head" }, el("span", { text: String(y) }), el("small", { text: `${items.length} 件` })));
    const ol = el("ol", { class: "hist-list" });
    for (const e of items) {
      ol.append(el("li", { class: `hist-item cat-${e.cat.slug}` },
        el("p", { class: "hist-meta" },
          e.m ? el("time", { text: dateLabel(e) }) : null,
          el("span", { class: "hist-cat", text: e.cat.name })),
        titleLine(e),
        e.note ? el("p", { class: "hist-sub", text: e.note }) : null,
        videoLine(e)));
    }
    sec.append(ol);
    box.append(sec);
  }
  if (!list.length) box.append(el("p", { class: "hist-loading", text: current === "mv" ? "MV はまだありません。" : "このカテゴリの出来事はまだありません。" }));
  renderEras(list);
}

// MV のある曲を1曲ずつの行にする。曲名は、ラベルの「」の中（MV「光」→ 光）か、ラベルが「MV」だけなら出来事の「」の中の名前。
// 下の小さな文字に、もとの出来事（シングル・アルバムなど）を出す。
let mvCache = null;
function mvSongs() {
  if (mvCache) return mvCache;
  const firstName = (t) => (t.match(/[「『]([^」』]+)[」』]/) || [])[1] || t;
  mvCache = events.flatMap((e) => e.videos.filter((v) => /^MV/.test(v.label)).map((v, j) => {
    const rest = v.label.slice(2).trim();
    const name = /^「.+」$/.test(rest) ? rest.slice(1, -1) : firstName(e.title) + (rest ? (/^[（(]/.test(rest) ? rest : ` ${rest}`) : "");
    return { y: e.y, m: e.m, d: e.d, ey: 0, em: 0, ed: 0, cat: MV_TAB, title: `「${name}」`, note: e.title, i: e.i * 100 + j,
      site: "", tower: "", videos: [{ label: "MV を見る", id: v.id }] };
  }));
  return mvCache;
}

// タワーレコードのリンク。CSV には、検索する言葉（例：RADWIMPS 人間開花）か、tower.jp の商品ページの URL を書く。
// config.js にバリューコマースの sid・pid を書くと、アフィリエイトリンクになる。
const AFF = config.towerAffiliate || {};
const affiliateOn = !!(AFF.sid && AFF.pid);
function towerUrl(v) {
  if (!v) return "";
  const plain = /^https:\/\/tower\.jp\/[^\s"<>]*$/.test(v) ? v : `https://tower.jp/search/item/${encodeURIComponent(v)}`;
  if (!affiliateOn) return plain;
  return `https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=${encodeURIComponent(AFF.sid)}&pid=${encodeURIComponent(AFF.pid)}&vc_url=${encodeURIComponent(plain)}`;
}

// 出来事の見出し。いちばん初めの「」か『』の中（作品名・ライブ名）を、リンクにする。
//   リリース：タワーレコード（CSV の「タワーレコード」の列）
//   ライブ：特設サイト、なければ公式サイトのライブ情報のページ（「特設サイト」の列）
//   リンクにするのは作品名の文字だけ（行全体にはしない）。点線の下線で、控えめに示す。
function titleLine(e) {
  const p = el("p", { class: "hist-title" });
  const href = e.tower || e.site;
  const m = href ? e.title.match(/[「『]/) : null;
  if (!m) { p.textContent = e.title; return p; }
  const open = m.index, close = e.title.indexOf(m[0] === "「" ? "」" : "』", open + 1);
  if (close < 0) { p.textContent = e.title; return p; }
  const name = e.title.slice(open + 1, close);
  const tower = !!e.tower;
  const a = el("a", {
    class: "title-link", href, target: "_blank",
    rel: tower && affiliateOn ? "sponsored noopener noreferrer" : "noopener noreferrer",
    title: tower ? `「${name}」をタワーレコードで見る（新しいタブで開きます）`
      : /radwimps\.jp\/live(_archive)?\//.test(href) ? `「${name}」の公式サイトのライブ情報（新しいタブで開きます）` : `「${name}」の特設サイト（新しいタブで開きます）`
  }, name);
  p.append(e.title.slice(0, open + 1), a, e.title.slice(close));
  if (tower && affiliateOn) p.append(el("span", { class: "pr", text: "PR", title: "広告（アフィリエイトリンク）" }));
  return p;
}

// 動画（MV・予告編など）。CSV の「動画」の列に「ラベル=YouTube の ID か URL」を「 | 」で区切って書く。
//   例：MV=XRnX65LDRoU　／　MV「光」=WuU6C8oXzIA | MV「前前前世 [original ver.]」=vLGQQbjZc5A　／　予告編=https://www.youtube.com/watch?v=…
function ytId(v) {
  if (/^[A-Za-z0-9_-]{11}$/.test(v)) return v;
  try {
    const u = new URL(v);
    if (u.hostname === "youtu.be") return (u.pathname.match(/^\/([A-Za-z0-9_-]{11})/) || [])[1] || "";
    if (/(^|\.)youtube(-nocookie)?\.com$/.test(u.hostname))
      return u.searchParams.get("v") || (u.pathname.match(/\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/) || [])[1] || "";
  } catch { /* URL ではない */ }
  return "";
}
function videoList(v) {
  if (!v) return [];
  return v.split("|").map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = x.match(/^(?:(.*?)\s*=\s*)?(https:\/\/\S+|[A-Za-z0-9_-]{11})$/);
    const id = m ? ytId(m[2]) : "";
    return id ? { label: (m[1] || "MV").trim() || "MV", id } : null;
  }).filter(Boolean);
}
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
  open.remove();
  document.querySelectorAll('#timeline .vbtn[aria-expanded="true"]').forEach((b) => b.setAttribute("aria-expanded", "false"));
}
function openPlayer(btn) {
  const id = btn.dataset.vid, label = btn.dataset.label;
  const li = btn.closest(".hist-item");
  const title = li.querySelector(".hist-title").textContent;
  const frame = el("div", { class: "frame" }, el("iframe", {
    src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0`,
    title: `${label}（${title}）`, referrerpolicy: "strict-origin-when-cross-origin", frameborder: "0",
    allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen", allowfullscreen: ""
  }));
  const close = el("button", { type: "button", class: "pclose", text: "閉じる" });
  close.addEventListener("click", () => { closePlayer(); btn.focus(); });
  const player = el("div", { class: "hist-player" }, frame,
    el("p", { class: "player-foot" },
      el("a", { href: `https://www.youtube.com/watch?v=${id}`, target: "_blank", rel: "noopener noreferrer", text: "YouTube で開く" }), close));
  li.append(player);
  btn.setAttribute("aria-expanded", "true");
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
  if (e.target.closest("a.title-link")) { if (tapIsAccident()) e.preventDefault(); return; }
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

// メニュー（記事一覧のページと同じ動き）
function setMenuOpen(open) {
  const btn = $("#menuBtn"), clip = $("#menuClip");
  btn.setAttribute("aria-expanded", String(open));
  btn.setAttribute("aria-label", open ? "メニューを閉じる" : "メニューを開く");
  clip.classList.toggle("open", open);
  clip.setAttribute("aria-hidden", String(!open));
  if (open) clip.removeAttribute("inert"); else clip.setAttribute("inert", "");
}
$("#menuBtn").addEventListener("click", () => setMenuOpen($("#menuBtn").getAttribute("aria-expanded") !== "true"));
document.addEventListener("click", (e) => {
  if ($("#menuBtn").getAttribute("aria-expanded") === "true" && !e.target.closest("#menuClip, #menuBtn")) setMenuOpen(false);
});
addEventListener("keydown", (e) => { if (e.key === "Escape") setMenuOpen(false); });
try { if (localStorage.getItem("radwimps-interview-index:admin") === "1") $("#adminLink").hidden = false; } catch { /* 保存できない環境 */ }

// 読み込み
(async () => {
  try {
    const res = await fetch("data/history.csv", { cache: "no-cache" });
    if (!res.ok) throw new Error();
    events = load(await res.text());
    if (events.length) $("#span").textContent = `${events[0].y} — ${events[events.length - 1].y}`;
    if (affiliateOn) $("#prNote").hidden = $("#prTop").hidden = false;
    setCat(location.hash.slice(1));
  } catch {
    $("#loading").textContent = "年表を読み込めませんでした。時間をおいて、もう一度開いてください。";
  }
})();
addEventListener("hashchange", () => { if (VIEWS.includes(location.hash.slice(1))) setCat(location.hash.slice(1)); });
