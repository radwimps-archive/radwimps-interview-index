// assets/feedback.js
// ベータ版の表示（ロゴ横の「ベータ版」と、閉じられる案内バー）と、ご意見・不具合の受付先（Google フォーム）へのリンクを作ります。
// 記事一覧（app.js）と年表（history.js）で使います。
//
// 受付先の決め方（上から順に、設定してあるものを使います）：
//   1. config.js の mail.key（Web3Forms の鍵）があれば、このサイトの中の送信フォームから、運営者のメールに届きます。
//      運営者のメールアドレスはサイトに出ません（鍵だけが見えますが、鍵ではメールアドレスはわかりません）。
//   2. config.js の feedback.url に Google フォームの URL があれば、Google フォームへ。
//   3. どちらもなければ、GitHub の Issue へ（repoUrl がわかるときだけ）。それもなければ、リンクは出しません。

import config from "./config.js";
import { h } from "./ui.js";

const FB = config.feedback || {};
const MAIL_KEY = /^[0-9a-f-]{20,}$/i.test((config.mail && config.mail.key) || "") ? config.mail.key : "";
const MAIL_API = "https://api.web3forms.com/submit"; // ここを変えたら、各ページの CSP（connect-src）も同じに直す
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

// 受付先があるか・アカウントなしで送れる形（メールのフォームか Google フォーム）か
export const hasFeedback = !!(MAIL_KEY || FORM || REPO);
export const usesForm = !!(MAIL_KEY || FORM);

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
  if (MAIL_KEY) {
    // このサイトの中の送信フォームを開く印（押すと openReport が開きます。下の「送信フォーム」）
    return "#report?" + new URLSearchParams({ kind, page, content }).toString();
  }
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

/* ---------- ベータ版の表示 ---------- */

const STORE_BAR = "radwimps-interview-index:beta-bar-closed";

// ロゴ横の「ベータ版」と、ページ上部の案内バーを出します（config.js の beta が true のときだけ）。
//   before：案内バーを入れる場所（この部品の前に入れます）
export function setupBeta(before) {
  if (!config.beta) return;
  for (const brand of document.querySelectorAll(".brand")) {
    if (!brand.querySelector(".beta-badge")) brand.append(h("span", { class: "beta-badge", text: "ベータ版" }));
  }
  let closed = false;
  try { closed = localStorage.getItem(STORE_BAR) === "1"; } catch { /* 保存できない環境では毎回出す */ }
  if (closed || !before) return;
  const url = feedbackUrl({ kind: KIND.bug, title: "ベータ版の感想・不具合", page: location.href });
  const close = h("button", { type: "button", class: "beta-close", "aria-label": "この案内を閉じる", text: "✕" });
  const bar = h("aside", { class: "beta-bar", "aria-label": "ベータ版のお知らせ" },
    h("p", null, h("strong", { text: "ベータ版で公開中です。" }), "表示のおかしなところや使いにくいところがあれば、",
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

/* ---------- 送信フォーム（config.js の mail.key があるとき） ---------- */

// 「#report?…」のリンクを押したら、新しいタブで開かずに、このページの中で送信フォームを開きます
if (MAIL_KEY) {
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#report?"]');
    if (!a) return;
    e.preventDefault();
    const q = new URLSearchParams(a.getAttribute("href").slice("#report?".length));
    openReport({ kind: q.get("kind") || "", page: q.get("page") || "", content: q.get("content") || "" });
  });
}

let dialog = null;
export function openReport({ kind = "", page = "", content = "" } = {}) {
  if (!MAIL_KEY) return;
  if (dialog) dialog.remove();
  const sel = h("select", { id: "fbKind", required: true },
    h("option", { value: "", text: "選んでください" }),
    ...Object.values(KIND).map((k) => h("option", { value: k, text: k, selected: k === kind })));
  const body = h("textarea", { id: "fbBody", rows: "5", required: true, maxlength: "4000" });
  body.value = content;
  const where = h("textarea", { id: "fbPage", rows: "2", maxlength: "1000" });
  where.value = page;
  const device = h("input", { id: "fbDevice", type: "text", autocomplete: "off", maxlength: "200" });
  device.value = deviceText();
  const reply = h("input", { id: "fbReply", type: "text", autocomplete: "email", maxlength: "200", placeholder: "例：メールアドレスや X の ID（返信が不要なら空欄）" });
  // ロボットよけ（人には見えない欄。ここに何か入っていたら送らない）
  const trap = h("input", { type: "checkbox", name: "botcheck", class: "fb-trap", tabindex: "-1", "aria-hidden": "true" });
  const send = h("button", { type: "submit", class: "btn primary", text: "送信する" });
  const msg = h("p", { class: "msg", role: "status" });
  const form = h("form", { class: "addform", novalidate: true },
    h("label", { for: "fbKind" }, "種類（必須）", sel),
    h("label", { for: "fbBody" }, "内容（必須）", body),
    h("label", { for: "fbPage" }, "記事やページ（わかれば）", where),
    h("label", { for: "fbDevice" }, "使っている端末・ブラウザ", device),
    h("label", { for: "fbReply" }, "返信が必要なときの連絡先（任意）", reply),
    trap, send, msg);
  const close = h("button", { type: "button", class: "modal-close", "aria-label": "閉じる", text: "✕" });
  dialog = h("dialog", { class: "modal", "aria-labelledby": "fbTitle" },
    h("div", { class: "modal-shell" }, close,
      h("p", { class: "modal-eyebrow", text: "REPORT" }),
      h("h2", { id: "fbTitle", text: "ご意見・不具合を知らせる" }),
      h("p", { text: "メール転送サービス（Web3Forms）を通って、運営者のメールに届きます。アカウントは不要です。返信が必要なときだけ、連絡先を書いてください（ほかの人には見えません）。" }),
      form));
  const back = document.activeElement;
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => { if (back && document.contains(back)) back.focus(); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.classList.remove("err");
    if (!sel.value || !body.value.trim()) { msg.classList.add("err"); msg.textContent = "「種類」と「内容」を入れてください。"; return; }
    if (trap.checked) return;
    send.disabled = true;
    msg.textContent = "送っています…";
    try {
      const res = await fetch(MAIL_API, {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: MAIL_KEY,
          subject: `【RADWIMPS Archives】${sel.value}`,
          from_name: "RADWIMPS Archives の報告フォーム",
          "種類": sel.value, "内容": body.value.trim(), "記事やページ": where.value.trim(),
          "端末": device.value.trim(), "連絡先": reply.value.trim(), "送ったページ": location.href,
          botcheck: false
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.message || res.status);
      form.replaceWith(h("p", { text: "送りました。ありがとうございます！ 内容を確かめて、サイトに反映します。" }));
    } catch {
      send.disabled = false;
      msg.classList.add("err");
      msg.textContent = "送れませんでした。時間をおいて、もう一度試してください。";
    }
  });
  document.body.append(dialog);
  dialog.showModal();
  sel.focus();
}
