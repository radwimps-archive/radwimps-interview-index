// assets/sites.js
// 「特設サイト」の部屋（sites.html）の動き。中身は data/sites.csv（読み取りは data.js の parseSites）。
//   ・年ごとに、新しい順に並べる（「RADWIMPSの歩み」の年表と同じ見た目）。
//   ・上のタブで、種類（ライブ・ツアー／作品／周年・企画／その他）ごとに絞り込める。URL の #live などでも開ける。
//   ・公開が終わったサイトは「公開終了」の印を付け、名前は Internet Archive の保存版へのリンクにする。公開中のサイトにも、保存版があれば小さく出す。

import "./analytics.js";
import { parseSites, SITE_KINDS, HISTORY_CATEGORIES } from "./data.js";
import { h, setupMenu, isAdminDevice, watchScrollFade } from "./ui.js";
import { setupBeta } from "./feedback.js";

const $ = (s) => document.querySelector(s);
const pad = (n) => String(n).padStart(2, "0");
const dateLabel = (s) => `${s.y}${s.m ? "." + pad(s.m) : ""}${s.d ? "." + pad(s.d) : ""}`;
// 年表と同じ色の印を使う（種類 → 年表のカテゴリ）
const catOf = (kind) => HISTORY_CATEGORIES.find((c) => c.name === kind.history) || HISTORY_CATEGORIES[0];

let sites = [];
let current = SITE_KINDS.some((k) => k.slug === location.hash.slice(1)) ? location.hash.slice(1) : "all";

// タブは読み込んだときに1回だけ作る（押すたびに作り直すと、キーボードで押したときにフォーカスが消えるため）。件数が0の種類は出さない
function buildTabs() {
  const tabs = [{ slug: "all", name: "すべて" }, ...SITE_KINDS];
  $("#siteKinds").replaceChildren(...tabs.map((t) => {
    const n = t.slug === "all" ? sites.length : sites.filter((s) => s.kind.slug === t.slug).length;
    if (!n && t.slug !== "all") return "";
    return h("button", { type: "button", "data-kind": t.slug, "aria-pressed": "false", "aria-label": `${t.name} ${n}件` },
      h("span", { text: t.name }), h("small", { text: String(n) }));
  }));
}
function syncTabs() {
  // # で開いた種類のタブがない（件数が0）ときは「すべて」にする
  if (!document.querySelector(`#siteKinds [data-kind="${CSS.escape(current)}"]`)) current = "all";
  for (const b of document.querySelectorAll("#siteKinds [data-kind]")) b.setAttribute("aria-pressed", String(b.dataset.kind === current));
}

// メモの頭の「日付：…。」は運営向けの覚え書きなので、画面には出さない
const noteOf = (s) => s.note.replace(/^日付：[^。]*。?/, "").trim();

function siteItem(s) {
  const c = catOf(s.kind);
  const href = s.closed ? s.archive : s.url;
  const title = href
    ? h("a", { class: "title-link", href, target: "_blank", rel: "noopener noreferrer" }, s.name,
      h("span", { class: "sr", text: s.closed ? "（公開終了。Internet Archive の保存版を新しいタブで開きます）" : "（特設サイトを新しいタブで開きます）" }))
    : s.name;
  const links = [];
  if (!s.closed && s.archive) links.push(h("a", { class: "site-archive", href: s.archive, target: "_blank", rel: "noopener noreferrer", "aria-label": `${s.name}の保存版（Internet Archive）を新しいタブで開く`, text: "保存版 ↗" }));
  return h("li", { class: `hist-item cat-${c.slug}` },
    h("p", { class: "hist-meta" },
      h("time", { text: dateLabel(s) }),
      h("span", { class: `hist-cat cat-${c.slug}`, text: s.kind.name }),
      s.closed ? h("span", { class: "site-closed", text: "公開終了" }) : null),
    h("p", { class: "hist-title" }, title),
    noteOf(s) ? h("p", { class: "hist-sub", text: noteOf(s) }) : null,
    links.length ? h("p", { class: "site-links" }, ...links) : null);
}

function render() {
  syncTabs();
  const list = current === "all" ? sites : sites.filter((s) => s.kind.slug === current);
  const box = $("#sites");
  const years = new Map();
  for (const s of list) (years.get(s.y) || years.set(s.y, []).get(s.y)).push(s);
  box.replaceChildren(h("h2", { id: "sitesListTitle", class: "sr", text: "特設サイトの一覧" }));
  for (const [y, items] of years) {
    box.append(h("section", { class: "hist-year", id: `y${y}`, "aria-labelledby": `yh${y}` },
      h("h3", { id: `yh${y}`, class: "hist-year-head" }, h("span", { text: String(y) }), h("small", { text: `${items.length} 件` })),
      h("ol", { class: "hist-list" }, ...items.map(siteItem))));
  }
  if (!list.length) box.append(h("p", { class: "hist-loading", text: "この種類の特設サイトは、まだありません。" }));
}

$("#siteKinds").addEventListener("click", (e) => {
  const b = e.target.closest("[data-kind]");
  if (!b || b.dataset.kind === current) return;
  current = b.dataset.kind;
  try { history.replaceState(null, "", location.pathname + location.search + (current === "all" ? "" : `#${current}`)); } catch { /* 変えられない環境 */ }
  render();
});
addEventListener("hashchange", () => {
  const k = location.hash.slice(1);
  if (sites.length && (k === "" || SITE_KINDS.some((x) => x.slug === k))) { current = k || "all"; render(); }
});

setupMenu();
watchScrollFade($("#siteKinds"));
setupBeta($("#main").firstElementChild);
if (isAdminDevice()) $("#adminLink").hidden = false;

(async () => {
  try {
    const res = await fetch("data/sites.csv", { cache: "no-cache" });
    if (!res.ok) throw new Error("sites.csv: HTTP " + res.status);
    const parsed = parseSites(await res.text());
    if (parsed.errors.length) console.warn("特設サイトのデータに、直すところがあります", parsed.errors);
    sites = parsed.sites.filter((s) => s.state === "公開");
    $("#siteCount").textContent = `${sites.length}`;
    buildTabs();
    render();
  } catch (e) {
    console.error(e);
    $("#sites").replaceChildren(h("h2", { id: "sitesListTitle", class: "sr", text: "特設サイトの一覧" }),
      h("p", { class: "hist-loading", text: "特設サイトの一覧を読み込めませんでした。時間をおいて、ページを開き直してください。" }));
  }
})();
