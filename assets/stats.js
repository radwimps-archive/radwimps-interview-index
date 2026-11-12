// assets/stats.js
// 運営管理の「アクセス状況」のグラフです。運営管理を開いたときだけ読み込まれます（マニュアル13-6）。
//   ・数字は、Cloudflare に置いた「中継役」（Worker。中身は worker/stats-worker.js）から受け取ります。
//   ・中継役の URL と合言葉は、この端末のブラウザにだけ保存し、中継役以外には送りません。
//   ・Cloudflare の合鍵（API トークン）は中継役の中にだけあり、サイトには出てきません。

import { h } from "./ui.js";

const STORE_URL = "radwimps-interview-index:stats-url";
const STORE_KEY = "radwimps-interview-index:stats-key";
const STORE_DAYS = "radwimps-interview-index:stats-days";
const SVGNS = "http://www.w3.org/2000/svg";

const lsGet = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const lsSet = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* 保存できない環境 */ } };
const num = (n) => Number(n || 0).toLocaleString("ja-JP");
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const WEEK = "日月火水木金土";
const dow = (d) => WEEK[new Date(d + "T00:00:00Z").getUTCDay()];

// 中継役の URL として受け付けるもの（https の workers.dev だけ。CSP の connect-src と合わせています）
export function cleanWorkerUrl(s) {
  try {
    const u = new URL(String(s || "").trim());
    if (u.protocol !== "https:" || !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.workers\.dev$/i.test(u.hostname)) return "";
    return u.origin;
  } catch { return ""; }
}

// ページの名前（パス → 日本語）
const PAGE_NAMES = { "/": "記事一覧（トップ）", "/index.html": "記事一覧（トップ）", "/history.html": "RADWIMPSの歩み（年表）", "/songs.html": "楽曲一覧", "/members.html": "メンバー・人物紹介", "/maker.html": "作成ツール", "/404.html": "見つからないページ（404）" };
export function pageName(p) {
  const path = String(p || "/").replace(/^\/radwimps-interview-index(?=\/)/, "");
  return PAGE_NAMES[path] || path;
}
// どこから来たか（相手のサイト名 → わかりやすい名前）
export function refName(host) {
  const s = String(host || "").toLowerCase().replace(/^www\./, "");
  if (!s) return "直接・ブックマークなど";
  if (s === "radwimps-archive.github.io") return "サイトの中の移動";
  if (/(^|\.)google\./.test(s)) return "Google 検索";
  if (/(^|\.)yahoo\.(co\.jp|com)$/.test(s)) return "Yahoo! 検索";
  if (/(^|\.)bing\.com$/.test(s)) return "Bing 検索";
  if (s === "t.co" || s === "x.com" || s === "twitter.com") return "X（旧Twitter）";
  if (/instagram\.com$/.test(s)) return "Instagram";
  if (/threads\.(net|com)$/.test(s)) return "Threads";
  if (/facebook\.com$/.test(s)) return "Facebook";
  if (/youtube\.com$/.test(s)) return "YouTube";
  if (/line\.me$/.test(s)) return "LINE";
  return s;
}
// 国（"JP" のような2文字 → 日本語の名前）
export function countryName(c) {
  const s = String(c || "");
  if (!/^[A-Z]{2}$/.test(s)) return s || "不明";
  try { return new Intl.DisplayNames(["ja"], { type: "region" }).of(s) || s; } catch { return s; }
}
const DEVICE_NAMES = { mobile: "スマホ", desktop: "パソコン", tablet: "タブレット" };

/* ---------- 画面 ---------- */

export function mountStats(root, { dashboardUrl }) {
  let days = lsGet(STORE_DAYS) === "30" ? 30 : 7;
  let busy = false, resizeObs = null;

  const dashLink = () => h("ul", { class: "admlinks" }, h("li", null, h("a", { href: dashboardUrl, target: "_blank", rel: "noopener noreferrer" },
    h("span", { text: "Cloudflare の画面で詳しく見る" }), h("small", { text: "国・ブラウザ・表示の速さなど、もっと細かい数字（Cloudflare へのログインが必要）" }))));
  const note = () => h("p", { class: "hint", text: "この端末は管理者モードなので、ここからのアクセスは数えていません。数字が出るまで、数分かかることがあります。" });

  function showSetup(msg) {
    const url = h("input", { type: "url", inputmode: "url", autocomplete: "off", placeholder: "https://○○.○○.workers.dev", value: lsGet(STORE_URL) });
    const key = h("input", { type: "password", autocomplete: "off", value: lsGet(STORE_KEY) });
    const err = h("p", { class: "msg err", role: "alert", text: msg || "" });
    const save = h("button", { type: "button", class: "btn primary", text: "保存してグラフを出す" });
    save.addEventListener("click", () => {
      const u = cleanWorkerUrl(url.value);
      if (!u) { err.textContent = "中継役の URL は「https://」で始まり「.workers.dev」で終わるものを入れてください。"; return; }
      if (key.value.trim().length < 12) { err.textContent = "合言葉は、Worker に登録したもの（12文字以上）を入れてください。"; return; }
      lsSet(STORE_URL, u); lsSet(STORE_KEY, key.value.trim());
      load();
    });
    root.replaceChildren(
      h("div", { class: "admconnect" },
        h("p", { text: "アクセス数をここでグラフにするには、Cloudflare に「中継役」（Worker）を一度だけ用意します（マニュアル13-6。15〜20分ほど）。用意できたら、その URL と合言葉を入れてください。" }),
        h("label", { class: "admfield" }, "中継役（Worker）の URL", url),
        h("label", { class: "admfield" }, "合言葉", key, h("small", { text: "この端末のブラウザにだけ保存します。中継役以外には送りません。" })),
        err, h("div", { class: "admrow" }, save)),
      note(), dashLink());
  }

  async function load() {
    const url = lsGet(STORE_URL), key = lsGet(STORE_KEY);
    if (!url || !key) return showSetup();
    if (busy) return;
    busy = true;
    root.replaceChildren(h("p", { class: "hint", text: "数字を読み込んでいます…" }));
    let data;
    try {
      const res = await fetch(`${url}/?days=${days}`, { headers: { "X-Admin-Key": key }, cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) { lsSet(STORE_KEY, ""); return showSetup("合言葉が違います。Worker に登録した ADMIN_KEY と同じものを入れてください。"); }
      if (!res.ok) throw Object.assign(new Error(json.detail || ""), { code: json.error || String(res.status) });
      data = json;
    } catch (e) {
      const why = {
        "no-admin-key": "中継役に合言葉（ADMIN_KEY・12文字以上）が登録されていません。",
        "no-api-token": "中継役に Cloudflare の合鍵（CF_API_TOKEN）が登録されていません。",
        token: "Cloudflare の合鍵が使えません。許可が「Account Analytics：読み取り」になっているか、期限が切れていないか確かめてください。",
        account: "Cloudflare のアカウントが見つかりません。Worker に ACCOUNT_ID を登録してみてください。"
      }[e.code] || (e.code ? "中継役から数字を受け取れませんでした。少し待ってから、もう一度押してください。" : "中継役につながりません。URL が合っているか、通信できるかを確かめてください。");
      root.replaceChildren(h("p", { class: "msg err", role: "alert", text: why }),
        e.message ? h("p", { class: "hint", text: `くわしく：${e.message}` }) : null,
        h("div", { class: "admrow" }, button("もう一度読み込む", load), button("URL・合言葉を変える", () => showSetup())), dashLink());
      return;
    } finally { busy = false; }
    render(data);
  }

  function button(text, fn, attrs) {
    const b = h("button", { type: "button", class: "btn", text, ...attrs });
    b.addEventListener("click", fn);
    return b;
  }

  function render(d) {
    const range = h("div", { class: "statrange", role: "group", "aria-label": "期間" },
      ...[7, 30].map((n) => button(`${n}日`, () => { days = n; lsSet(STORE_DAYS, String(n)); load(); }, { "aria-pressed": String(days === n) })));
    const chartBox = h("div");
    const chartCard = h("section", { class: "statcard" }, h("h3", { text: "日ごとの訪問数" }), chartBox, dailyTable(d.daily));
    const avg = d.daily.length ? Math.round(d.total.visits / d.daily.length) : 0;
    root.replaceChildren(
      h("div", { class: "statbar" }, range, button("最新にする", load, { class: "btn plain" })),
      h("ul", { class: "admstats" },
        tile("訪問数", d.total.visits, `${md(d.from)}〜${md(d.to)}`),
        tile("見られた回数", d.total.views, "ページを開いた回数"),
        tile("1日あたりの訪問", avg, "平均")),
      chartCard,
      h("div", { class: "statgrid" },
        barList("よく見られたページ", d.pages.map((r) => ({ label: pageName(r.name), value: r.views }))),
        barList("どこから来たか", mergeRefs(d.referrers)),
        barList("端末の種類", d.devices.map((r) => ({ label: DEVICE_NAMES[r.name] || r.name || "不明", value: r.views }))),
        barList("国・地域", d.countries.map((r) => ({ label: countryName(r.name), value: r.views })))),
      h("p", { class: "hint", text: `「訪問数」はサイトに来た回数（続けて何ページ見ても1回）、「見られた回数」はページを開いた回数です。日の区切りは日本時間です。${new Date(d.updated).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 時点。` }),
      note(),
      h("div", { class: "admrow" }, button("URL・合言葉を変える", () => showSetup())),
      dashLink());
    const draw = () => chartBox.replaceChildren(lineChart(d.daily, chartBox.clientWidth));
    draw();
    if (resizeObs) resizeObs.disconnect();
    let lastW = chartBox.clientWidth;
    resizeObs = new ResizeObserver(() => { if (chartBox.clientWidth && Math.abs(chartBox.clientWidth - lastW) > 8) { lastW = chartBox.clientWidth; draw(); } });
    resizeObs.observe(chartBox);
  }

  load();
  return { reload: load };
}

function tile(label, value, sub) {
  return h("li", null, h("span", { text: label }), h("b", { text: num(value) }), h("small", { text: sub }));
}

// 同じ名前になった行（google.com と google.co.jp など）をまとめる
function mergeRefs(rows) {
  const m = new Map();
  for (const r of rows) { const k = refName(r.name); m.set(k, (m.get(k) || 0) + r.views); }
  return [...m].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

// 横棒の一覧（数の大きさを棒の長さで。色は1色だけ）
function barList(title, rows) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return h("section", { class: "statcard" }, h("h3", { text: title }),
    rows.length ? h("ol", { class: "statbars" }, ...rows.map((r) => {
      const bar = h("span", { class: "statbar-fill" });
      bar.style.setProperty("--w", `${Math.max(2, (r.value / max) * 100)}%`);
      return h("li", null, h("span", { class: "statbar-label", text: r.label }), h("b", { text: num(r.value) }), h("span", { class: "statbar-track", "aria-hidden": "true" }, bar));
    })) : h("p", { class: "hint", text: "まだ数字がありません。" }));
}

function dailyTable(daily) {
  return h("details", { class: "stattable" }, h("summary", { text: "表で見る" }),
    h("table", null,
      h("thead", null, h("tr", null, h("th", { text: "日付" }), h("th", { text: "訪問数" }), h("th", { text: "見られた回数" }))),
      h("tbody", null, ...[...daily].reverse().map((r) => h("tr", null, h("td", { text: `${md(r.date)}（${dow(r.date)}）` }), h("td", { text: num(r.visits) }), h("td", { text: num(r.views) }))))));
}

const s = (tag, attrs) => {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  return el;
};

// きりのいい目盛り：1本ぶん（step）が 1・2・5 の倍数で、0 から上まで2〜5本になるように
export function niceScale(v) {
  const top = Math.max(4, Math.ceil(v));
  for (let p = 1; ; p *= 10) for (const m of [1, 2, 5]) {
    const step = m * p, k = Math.ceil(top / step);
    if (k <= 5) return { max: step * Math.max(2, k), step };
  }
}
export const niceMax = (v) => niceScale(v).max;

// 日ごとの訪問数の折れ線（指でなぞる・マウスを乗せると、その日の数字が出ます）
//   幅は画面に合わせて決めます（文字の大きさが、スマホでもパソコンでも同じになるように）
function lineChart(daily, width) {
  const W = Math.max(280, Math.round(width || 640)), H = W < 500 ? 200 : 240, L = 40, R = 12, T = 12, B = 28;
  const n = daily.length, { max, step: tick } = niceScale(Math.max(...daily.map((d) => d.visits)));
  const x = (i) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "statline", role: "img", "aria-label": `日ごとの訪問数のグラフ。${daily.map((d) => `${md(d.date)} ${d.visits}`).join("、")}` });

  for (let v = 0; v <= max; v += tick) {
    const yy = y(v);
    svg.append(s("line", { x1: L, x2: W - R, y1: yy, y2: yy, class: v ? "grid" : "base" }));
    const t = s("text", { x: L - 6, y: yy + 4, class: "ylab", "text-anchor": "end" }); t.textContent = num(v); svg.append(t);
  }
  const step = n > 14 ? 7 : W < 420 ? 2 : 1;
  daily.forEach((d, i) => {
    if ((n - 1 - i) % step) return;
    const t = s("text", { x: x(i), y: H - 8, class: "xlab", "text-anchor": i === n - 1 ? "end" : i === 0 ? "start" : "middle" }); t.textContent = md(d.date); svg.append(t);
  });
  const pts = daily.map((d, i) => `${x(i).toFixed(1)},${y(d.visits).toFixed(1)}`);
  svg.append(s("path", { d: `M${x(0)},${y(0)} L${pts.join(" L")} L${x(n - 1)},${y(0)} Z`, class: "area" }));
  svg.append(s("path", { d: `M${pts.join(" L")}`, class: "line" }));
  if (n <= 14) daily.forEach((d, i) => svg.append(s("circle", { cx: x(i), cy: y(d.visits), r: 3.5, class: "pt" })));

  // なぞったときの縦線・印・吹き出し
  const cross = s("line", { y1: T, y2: H - B, class: "cross", visibility: "hidden" });
  const dot = s("circle", { r: 5, class: "hover", visibility: "hidden" });
  svg.append(cross, dot);
  const tip = h("div", { class: "stattip", hidden: true });
  const wrap = h("div", { class: "statchart" }, svg, tip);
  const show = (e) => {
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1))));
    const d = daily[i];
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(d.visits)); dot.setAttribute("visibility", "visible");
    tip.replaceChildren(h("b", { text: `${md(d.date)}（${dow(d.date)}）` }), h("span", { text: `訪問 ${num(d.visits)}` }), h("span", { text: `見られた回数 ${num(d.views)}` }));
    tip.hidden = false;
    const left = (x(i) / W) * box.width;
    tip.style.setProperty("--x", `${Math.max(60, Math.min(box.width - 60, left))}px`);
  };
  const hide = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); };
  svg.addEventListener("pointermove", show);
  svg.addEventListener("pointerdown", show);
  svg.addEventListener("pointerleave", hide);
  return wrap;
}
