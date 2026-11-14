// assets/attended.js
// 「行ったライブ」の印（ブックマーク）。「RAD LIVE SET LIST」と「RADWIMPSの歩み」で同じ印を使うので、片方で付けるともう片方にも出ます。
// 印はこの端末のブラウザ（localStorage）だけに保存します（サーバーには送りません）。別の端末とは共有されません。
// 公演ごとの印の名前（キー）は、公演日（例：2018-06-20）。同じ日に2公演あるときは、2つ目から「2018-06-20#2」のように番号をつけます。

import { h as el } from "./ui.js";

const STORE = "radwimps-interview-index:attended";
const KEY_OK = /^\d{4}(-\d{2}){0,2}(#\d{1,2})?$/;

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE));
    const out = new Set();
    if (raw && typeof raw === "object") for (const k of Object.keys(raw)) if (raw[k] && KEY_OK.test(k)) out.add(k);
    return out;
  } catch { return new Set(); }
}
let marks = load();
const listeners = new Set();
const notify = () => listeners.forEach((f) => f());

function persist() {
  try { localStorage.setItem(STORE, JSON.stringify(Object.fromEntries([...marks].map((k) => [k, 1])))); } catch { /* 保存できない環境では、このページを開いている間だけ有効 */ }
}

export const attended = {
  has: (k) => marks.has(k),
  set(k, on) { if (on) marks.add(k); else marks.delete(k); persist(); notify(); },
  count: (keys) => keys.filter((k) => marks.has(k)).length,
  onChange(f) { listeners.add(f); }
};
// 別のタブ（もう片方のページ）で印が変わったときも、すぐ反映する
addEventListener("storage", (e) => { if (e.key === STORE || e.key === null) { marks = load(); notify(); } });

// 公演（日付順に並んだもの）に、印の名前 l.ak をつける
export function assignKeys(lives) {
  const seen = new Map();
  for (const l of lives) {
    const n = (seen.get(l.date) || 0) + 1;
    seen.set(l.date, n);
    l.ak = n === 1 ? l.date : `${l.date}#${n}`;
  }
}

const shortVenue = (v) => (v || "").replace(/（.*）$/, "");
// 1公演の「行った」ボタン。押すたびに入れる・外す。ほかの同じ公演のボタンも、sync() で一緒に変わる
export function attendButton(l, { label = "行った" } = {}) {
  const name = `${l.date.replace(/-/g, ".")} ${shortVenue(l.venue)}`.trim();
  const b = el("button", { type: "button", class: "att-btn", "data-ak": l.ak, "aria-pressed": String(attended.has(l.ak)), "aria-label": `「${name}」を行ったライブに入れる`, title: "行ったライブの印（この端末だけに保存されます）" }, el("span", { text: label }));
  return b;
}
// 複数の公演（ツアーなど）の「行った ○／○公演」の表示
export function attendCount(lives) {
  const keys = lives.map((l) => l.ak);
  return el("span", { class: "att-count", "data-aks": keys.join(","), "data-n": String(keys.length) }, ` `);
}

// 画面にあるボタン・数を、いまの印に合わせる
export function sync(root = document) {
  for (const b of root.querySelectorAll(".att-btn[data-ak]")) b.setAttribute("aria-pressed", String(attended.has(b.dataset.ak)));
  for (const c of root.querySelectorAll(".att-count[data-aks]")) {
    const keys = c.dataset.aks.split(","), n = attended.count(keys);
    c.textContent = n ? `行った ${n}／${keys.length}公演` : "";
    c.hidden = !n;
  }
}
attended.onChange(() => sync());

// ボタンを押したときの動き（ページ全体で1回だけ呼ぶ）。details の summary の中のボタンでも、開閉は動かさない
export function setupAttendClicks() {
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".att-btn[data-ak]");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    attended.set(b.dataset.ak, b.getAttribute("aria-pressed") !== "true");
  }, true);
}
