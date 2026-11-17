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

/* ---------- 横にスクロールできるタブ：続きがある側の端をぼかす ---------- */

// 横にはみ出して、左右にスクロールできるタブの列に使います。続きがある側（左・右）の端を、CSS（data-fade）でぼかします
export function watchScrollFade(el) {
  if (!el) return;
  const update = () => {
    const max = el.scrollWidth - el.clientWidth;
    const l = el.scrollLeft > 2, r = el.scrollLeft < max - 2;
    const v = l && r ? "lr" : l ? "l" : r ? "r" : "";
    if (v) el.dataset.fade = v; else delete el.dataset.fade;
  };
  el.addEventListener("scroll", update, { passive: true });
  if (typeof ResizeObserver === "function") new ResizeObserver(update).observe(el); // 画面の幅が変わったとき（要素ごと消えれば、一緒に片づく）
  new MutationObserver(update).observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden", "aria-pressed", "aria-selected"] });
  update();
}

/* ---------- 上に貼りつく帯：貼りついているあいだだけ、印（data-stuck）を付ける ---------- */

// スクロールしても上に残る帯（position: sticky）に使います。帯がページの途中にあるあいだは背景を透明にして、まわりの背景に溶け込ませ、
// 上に貼りついたら（下を記事が流れるので）CSS で暗い地を敷きます（theme-blue.css の [data-stuck]）
export function watchStuck(el) {
  if (!el) return;
  let queued = false;
  const update = () => {
    queued = false;
    const top = parseFloat(getComputedStyle(el).top) || 0;
    const stuck = el.getBoundingClientRect().top <= top + 1 && scrollY > 0;
    if (stuck) el.dataset.stuck = ""; else delete el.dataset.stuck;
  };
  const ask = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
  addEventListener("scroll", ask, { passive: true });
  addEventListener("resize", ask);
  update();
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
