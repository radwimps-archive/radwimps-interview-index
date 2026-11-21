// assets/room-articles.js
// 楽曲一覧（songs.js）・メンバー紹介（members.js）に出す、短い記事の一覧です。
// 「どの部屋からでも棚に入れられる」（docs/concept.md の「あなたの棚」）ための部品で、
// 記事ごとに ♡（お気に入り）と「あとで読む」のボタンがあり、押すと「あなたの棚」に入ります。
//   ・印の保存場所と形は、記事一覧・あなたの棚と同じ（assets/marks.js）。
//   ・記事を開いたら既読にする（記事一覧と同じ）。
//   ・別のタブで印が変わったら、ボタンの状態をすぐそろえる。
//   ・並び順（新しい順・古い順）と、すべてをその場に出すかを、利用者が選べる。選んだものはこのブラウザに覚えておき、ページの中のほかの一覧にもそろえる。
// ページの HTML には、知らせを出す場所 <div id="toast" class="toast" role="status" aria-live="polite"></div> を置いてください。

import { h } from "./ui.js";
import { VIDEO_KIND, RADIO_KIND } from "./data.js";
import { STORE_MARKS, loadMarks, setMark, readJSON, writeJSON } from "./marks.js";
import { orderArticles } from "./shelf-data.js";

export const ROOM_LIMIT = 5; // 1つの曲・1人に、はじめに出す記事の数（「すべて表示」で残りも出せる。記事一覧でも見られる）

// 並び順と「すべて表示」の選択（このブラウザだけ。保存できない環境でも、そのページの中では効く）
const STORE_VIEW = "radwimps-interview-index:room-view";
const saved = readJSON(STORE_VIEW);
const view = { order: saved.order === "old" ? "old" : "new", all: saved.all === true };
const ORDER_NAME = { new: "新しい順", old: "古い順" };
const data = new WeakMap(); // 一覧の要素 → 作ったときの記事と設定（選び直したときに作り直すため）

const SVG = "http://www.w3.org/2000/svg";
// 記事一覧（app.js の HEART・BOOKMARK）と同じ形
const ICONS = {
  fv: "M12 20.2s-7.6-4.6-7.6-10.1A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.6 2.5c0 5.5-7.6 10.1-7.6 10.1z",
  lt: "M6.5 3.8h11v16.4L12 16.1l-5.5 4.1z"
};
function icon(kind) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG, "path");
  for (const [k, v] of Object.entries({ d: ICONS[kind], fill: "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linejoin": "round" })) path.setAttribute(k, v);
  svg.append(path);
  return svg;
}

const LABEL = {
  fv: { on: "お気に入りから外す", off: "お気に入りに追加", done: "お気に入りに追加しました", undone: "お気に入りから外しました" },
  lt: { on: "あとで読むから外す", off: "あとで読むに保存", done: "あとで読むに保存しました", undone: "あとで読むから外しました" }
};
const dotDate = (d) => (d || "").split("-").join(".");

function markButton(kind, it, on) {
  return h("button", { type: "button", class: kind === "fv" ? "save-button fav-button" : "save-button", "data-mark": kind, "data-id": it.id,
    "data-title": it.title, "aria-pressed": String(on), "aria-label": `${it.title}を${on ? LABEL[kind].on : LABEL[kind].off}` }, icon(kind));
}

function row(it, marks) {
  const verb = it.kind === VIDEO_KIND ? "見る" : it.kind === RADIO_KIND ? "聴く" : "読む";
  const meta = [it.date ? dotDate(it.date) : "日付不明", it.media, it.kind].filter(Boolean).join(" · ");
  return h("li", { class: "room-item" + (marks.rd.has(it.id) ? " is-read" : "") },
    h("div", { class: "room-item-main" },
      h("a", { class: "room-item-title", href: it.url, target: "_blank", rel: "noopener noreferrer", "data-open": it.id },
        it.title, h("span", { class: "sr", text: `（${it.media}で${verb}。新しいタブで開きます）` })),
      h("p", { class: "room-item-meta" }, meta, marks.rd.has(it.id) ? h("span", { class: "room-read", text: "✓ 既読" }) : null)),
    h("div", { class: "room-item-actions" }, markButton("fv", it, marks.fv.has(it.id)), markButton("lt", it, marks.lt.has(it.id))));
}

// 記事の短い一覧。list：新しい順に並んだ記事（shelf-data.js の pickArticles）
// heading：見出し（例「この曲の記事」。なしでもよい）、label：並び順などのボタンの読み上げに使う名前（例「前前前世の記事」）、
// more：記事一覧で全部を見るときの URL、moreText：そのリンクの文
export function roomArticles(list, opts) {
  const { heading, label = heading || "記事", more, moreText } = opts;
  const marks = loadMarks();
  const many = list.length > ROOM_LIMIT;
  const all = view.all || !many;
  const shown = orderArticles(list, view.order).slice(0, all ? list.length : ROOM_LIMIT);
  // 並び順は「押されている／いない」のあるボタン（aria-pressed）。読み上げの名前は、見えている文字で始める（音声で操作する人が、見えている文字で押せるように）
  const pick = (kind, value, text, pressed, cls = "room-view-btn") => h("button", { type: "button", class: cls, "data-view": kind, "data-value": value,
    "aria-pressed": pressed === null ? null : String(pressed), "aria-label": `${text}：${label}`, text });
  // 「すべて表示」「5件だけ表示」は、押すたびに文字が入れ替わる、ふつうのボタン
  const allBtn = (cls) => pick("all", view.all ? "0" : "1", view.all ? `${ROOM_LIMIT}件だけ表示` : `すべて表示（${list.length}件）`, null, cls);
  const tools = list.length > 1 ? h("div", { class: "room-view", role: "group", "aria-label": `${label}の並び順と、出す数` },
    ...["new", "old"].map((o) => pick("order", o, ORDER_NAME[o], view.order === o)),
    many ? allBtn() : null) : null;
  const el = h("div", { class: "room-articles" },
    heading ? h("p", { class: "room-articles-head" }, heading, h("small", { text: all ? `${list.length}件` : `${list.length}件中${ROOM_LIMIT}件` })) : null,
    tools,
    h("ul", { class: "room-list" }, ...shown.map((it) => row(it, marks))),
    h("p", { class: "room-articles-foot" },
      // すべて出しているときは、一覧の下でも5件に戻せるように（長い一覧の上まで戻らなくてよいように）
      many && view.all ? allBtn("room-view-btn room-fold") : null,
      many && !all && more ? h("a", { class: "room-more", href: more }, moreText || `記事一覧で${list.length}件すべて見る`, h("span", { "aria-hidden": "true", text: "→" })) : null,
      h("a", { class: "room-shelf", href: "shelf.html" }, "あなたの棚へ", h("span", { "aria-hidden": "true", text: "→" }))));
  data.set(el, { list, opts });
  return el;
}

// 並び順・「すべて表示」を選び直したら、ページの中の一覧をすべて作り直す（押したボタンにフォーカスを戻す）
function rebuildAll(root, focusBox, kind) {
  // kind が空のときは、フォーカスを動かさない（別のタブで選び直したとき）
  let again = null;
  for (const box of root.querySelectorAll(".room-articles")) {
    const d = data.get(box);
    if (!d) continue;
    const fresh = roomArticles(d.list, d.opts);
    box.replaceWith(fresh);
    if (box === focusBox) again = fresh.querySelector(kind === "order" ? `[data-view="order"][data-value="${view.order}"]` : `[data-view="all"]`);
  }
  if (again) again.focus();
}

// ボタンの状態を、保存されている印にそろえる（別のタブで変わったときなど）
function syncAll(root) {
  const marks = loadMarks();
  for (const b of root.querySelectorAll(".room-articles [data-mark]")) {
    const on = marks[b.dataset.mark].has(b.dataset.id);
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", `${b.dataset.title}を${on ? LABEL[b.dataset.mark].on : LABEL[b.dataset.mark].off}`);
  }
  for (const a of root.querySelectorAll(".room-articles [data-open]")) {
    const li = a.closest(".room-item"), read = marks.rd.has(a.dataset.open);
    if (li.classList.contains("is-read") === read) continue;
    li.classList.toggle("is-read", read);
    const meta = li.querySelector(".room-item-meta");
    const badge = meta.querySelector(".room-read");
    if (read && !badge) meta.append(h("span", { class: "room-read", text: "✓ 既読" }));
    if (!read && badge) badge.remove();
  }
}

let toastTimer = 0;
function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}

// 一覧の入る場所（root）で、押したときの動きを準備する（1ページに1回）
export function setupRoomArticles(root) {
  const markRead = (id) => { if (!loadMarks().rd.has(id)) { setMark("rd", id, true); syncAll(root); } };
  root.addEventListener("click", (e) => {
    const v = e.target.closest(".room-articles [data-view]");
    if (v) {
      if (v.dataset.view === "order") { if (view.order === v.dataset.value) return; view.order = v.dataset.value; }
      else view.all = v.dataset.value === "1";
      writeJSON(STORE_VIEW, view);
      rebuildAll(root, v.closest(".room-articles"), v.dataset.view);
      return;
    }
    const b = e.target.closest(".room-articles [data-mark]");
    if (b) {
      const kind = b.dataset.mark, id = b.dataset.id;
      const on = !loadMarks()[kind].has(id); // 書く直前の印で決める（別のタブで変わっていても、押した見た目どおりになるように）
      if (!setMark(kind, id, on)) { toast("このブラウザでは保存できませんでした"); return; }
      syncAll(root);
      toast(on ? `${LABEL[kind].done}（あなたの棚に入りました）` : LABEL[kind].undone);
      return;
    }
    // 記事を開いたら、既読にする（記事一覧と同じ）
    const open = e.target.closest(".room-articles [data-open]");
    if (open) setTimeout(() => markRead(open.dataset.open), 0);
  });
  // 中ボタンで開いたときも既読にする
  root.addEventListener("auxclick", (e) => {
    const open = e.button === 1 && e.target.closest(".room-articles [data-open]");
    if (open) markRead(open.dataset.open);
  });
  addEventListener("storage", (e) => {
    if (e.key === STORE_MARKS || e.key === null) syncAll(root);
    // 別のタブで並び順や数を選び直したら、このタブの一覧もそろえる
    if (e.key === STORE_VIEW || e.key === null) {
      const v = readJSON(STORE_VIEW), order = v.order === "old" ? "old" : "new", all = v.all === true;
      if (order !== view.order || all !== view.all) { view.order = order; view.all = all; rebuildAll(root, null, ""); }
    }
  });
}
