// assets/feedback.js
// β版の表示（ロゴ横の「β版」と、閉じられる案内バー）と、ご意見・不具合の受付先（Google フォーム）へのリンクを作ります。
// 記事一覧（app.js）と年表（history.js）で使います。
//
// 受付先の決め方：
//   config.js の feedback.url に Google フォームの URL があれば、フォームへ（GitHub のアカウントがなくても送れる）。
//   空欄のときは、今までどおり GitHub の Issue へ（repoUrl がわかるときだけ）。どちらもなければ、リンクは出しません。

import config from "./config.js";
import { h } from "./ui.js";

const FB = config.feedback || {};
const FORM = /^https:\/\/(docs\.google\.com\/forms|forms\.gle)\//.test(FB.url || "") ? FB.url : "";

// フォームの質問①「種類」の選択肢（Google フォームの選択肢と、1文字も違わないようにする）
export const KIND = {
  bug: "不具合（表示がおかしい・動かない）",
  error: "記事の誤り・リンク切れ",
  add: "載せてほしい記事",
  ux: "使いやすさ・デザインの感想",
  contact: "掲載についてのお問い合わせ（削除のご依頼など）",
  other: "その他"
};

// GitHub のリポジトリの URL（config.js の repoUrl。なければ ○○.github.io の URL から見つける）
export function repoUrl() {
  if (config.repoUrl) return config.repoUrl.replace(/\/+$/, "");
  const m = location.hostname.match(/^([a-z0-9-]+)\.github\.io$/i);
  if (!m) return "";
  const first = location.pathname.split("/").filter(Boolean)[0];
  const repo = first && !/\.html?$/i.test(first) ? first : location.hostname;
  return `https://github.com/${m[1]}/${repo}`;
}
const REPO = repoUrl();

// 受付先があるか・Google フォームか
export const hasFeedback = !!(FORM || REPO);
export const usesForm = !!FORM;

// 使っている端末のおおよその説明（例：「iPhone・Safari・幅390px」）。フォームに事前に入れておくためのもので、どこにも送りません。
export function deviceText() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "iPad"
    : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) && !/OPR\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari" : "";
  return [os, br, `幅${window.innerWidth}px`].filter(Boolean).join("・");
}

// 受付先の URL を作ります：feedbackUrl({ kind: KIND.error, page: "記事のタイトルと URL", content: "最初に入れておく文" })
//   Google フォームのときは、種類・記事やページ・内容・端末を事前に入れたリンクに（config.js に entry 番号があるものだけ）。
//   GitHub のときは、Issue の題名と本文に入れます。
export function feedbackUrl({ kind = "", page = "", content = "", title = "" } = {}) {
  if (FORM) {
    const q = new URLSearchParams();
    const put = (key, value) => { if (FB[key] && value) q.set(`entry.${String(FB[key]).replace(/^entry\./, "")}`, value); };
    put("kind", kind);
    put("page", page);
    put("content", content);
    put("device", deviceText());
    const s = q.toString();
    return s ? `${FORM}${FORM.includes("?") ? "&" : "?"}usp=pp_url&${s}` : FORM;
  }
  if (!REPO) return "";
  const body = [page ? `記事やページ：${page}` : "", `気づいたこと：\n${content}`, `端末：${deviceText()}`].filter(Boolean).join("\n\n");
  return `${REPO}/issues/new?title=${encodeURIComponent(title || kind || "お知らせ")}&body=${encodeURIComponent(body + "\n")}`;
}

/* ---------- β版の表示 ---------- */

const STORE_BAR = "radwimps-interview-index:beta-bar-closed";

// ロゴ横の「β版」と、ページ上部の案内バーを出します（config.js の beta が true のときだけ）。
//   before：案内バーを入れる場所（この部品の前に入れます）
export function setupBeta(before) {
  if (!config.beta) return;
  for (const brand of document.querySelectorAll(".brand")) {
    if (!brand.querySelector(".beta-badge")) brand.append(h("span", { class: "beta-badge", text: "β版" }));
  }
  let closed = false;
  try { closed = localStorage.getItem(STORE_BAR) === "1"; } catch { /* 保存できない環境では毎回出す */ }
  if (closed || !before) return;
  const url = feedbackUrl({ kind: KIND.bug, title: "β版の感想・不具合", page: location.href });
  const close = h("button", { type: "button", class: "beta-close", "aria-label": "この案内を閉じる", text: "✕" });
  const bar = h("aside", { class: "beta-bar", "aria-label": "β版のお知らせ" },
    h("p", null, h("strong", { text: "β版で公開中です。" }), "表示のおかしなところや使いにくいところがあれば、",
      url ? h("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: usesForm ? "フォームから教えてください" : "教えてください" }) : "お知らせください",
      "。"),
    close);
  const wrap = h("div", { class: "wrap beta-wrap" }, bar);
  close.addEventListener("click", () => {
    wrap.remove();
    try { localStorage.setItem(STORE_BAR, "1"); } catch { /* 保存できなくても閉じる */ }
  });
  before.before(wrap);
}
