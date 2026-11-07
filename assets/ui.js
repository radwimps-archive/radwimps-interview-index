// assets/ui.js
// 画面の共通部品です。記事一覧（app.js）・運営管理（admin.js）・年表（history.js）で同じものを使います。
// ※ ここには画面（ブラウザ）を使う処理だけを置きます。
//   データの読み取りのように、チェック用のスクリプト（tools フォルダ）でも使う処理は data.js に置きます。

// 画面の部品を作る小さな関数：h("p", { class: "note", text: "本文" }, 子の部品, …)
//   null・undefined・false の属性や子は無視します。true の属性は、値なしの属性（例：hidden）になります。
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}

/* ---------- 管理者モード（この端末だけの設定） ---------- */

const STORE_ADMIN = "radwimps-interview-index:admin";
export function isAdminDevice() {
  try { return JSON.parse(localStorage.getItem(STORE_ADMIN)) === 1; } catch { return false; }
}
export function setAdminDevice(on) {
  try { if (on) localStorage.setItem(STORE_ADMIN, "1"); else localStorage.removeItem(STORE_ADMIN); } catch { /* 保存できない環境では何もしない */ }
}

/* ---------- 左上のメニュー（≡） ---------- */

// メニューの開け閉めを準備して、開け閉めする関数を返します：setMenuOpen(開くなら true, { focusBack })
//   閉じるとき、メニューの中にいた操作の位置（フォーカス）は、メニューのボタンに戻します（focusBack: false で戻さない）。
//   メニューの外を押したときと Esc キーでも閉じます。
export function setupMenu() {
  const btn = document.getElementById("menuBtn"), clip = document.getElementById("menuClip");
  const isOpen = () => btn.getAttribute("aria-expanded") === "true";
  function setMenuOpen(open, { focusBack = true } = {}) {
    btn.setAttribute("aria-expanded", String(open));
    btn.setAttribute("aria-label", open ? "メニューを閉じる" : "メニューを開く");
    clip.classList.toggle("open", open);
    clip.setAttribute("aria-hidden", String(!open));
    if (open) clip.removeAttribute("inert"); else clip.setAttribute("inert", "");
    if (!open && focusBack && clip.contains(document.activeElement)) btn.focus();
  }
  btn.addEventListener("click", () => setMenuOpen(!isOpen()));
  document.addEventListener("click", (e) => {
    if (isOpen() && !e.target.closest("#menuClip, #menuBtn")) setMenuOpen(false, { focusBack: false });
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) setMenuOpen(false); });
  return setMenuOpen;
}

/* ---------- ファイルの書き出し ---------- */

// 文字をファイルにして、この端末に保存（ダウンロード）します：downloadFile("articles.csv", 中身, "text/csv")
export function downloadFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
