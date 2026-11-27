// assets/text.js
// 検索や分け方のために、文字をそろえる関数です。記事一覧（app.js）と「あなたの棚」（shelf-data.js）で同じものを使います。
// 片方だけ直すと結果がずれるので、ここ1か所で直してください。

// 全角半角・大文字小文字・ひらがなとカタカナの違いをなくし、記号や空白を取り除く
export const STRIP = /[\s　・、，,。．.／/「」『』【】〔〕［］[\]（）()<>＜＞〈〉《》\-‐–—―_~〜～!！?？:：;；'"“”‘’`*＊#＃|｜×✕+＋&＆]/g;
export function norm(s) {
  return String(s || "").normalize("NFKC").toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(STRIP, "");
}

// そろえた文字 hay の中に、そろえた名前 n がそのまま入っているか。
// ただし、数字で終わる名前のすぐあとに数字が続くところ（数字で始まる名前のすぐ前に数字があるところ）は数えない。
// 例：アルバム「RADWIMPS 2」は「RADWIMPS 20th ANNIVERSARY」「RADWIMPS 2015 …」に入っていても、その作品とはみなさない
// （記事一覧・あなたの棚・楽曲一覧で、名前がそのまま出てくる記事を探すときに使う）
export function hasName(hay, n) {
  if (!n) return false;
  const tailNum = /[0-9]$/.test(n), headNum = /^[0-9]/.test(n);
  for (let i = hay.indexOf(n); i >= 0; i = hay.indexOf(n, i + 1)) {
    if (tailNum && /[0-9]/.test(hay[i + n.length] || "")) continue;
    if (headNum && /[0-9]/.test(hay[i - 1] || "")) continue;
    return true;
  }
  return false;
}
