// assets/text.js
// 検索や分け方のために、文字をそろえる関数です。記事一覧（app.js）と「あなたの棚」（shelf-data.js）で同じものを使います。
// 片方だけ直すと結果がずれるので、ここ1か所で直してください。

// 全角半角・大文字小文字・ひらがなとカタカナの違いをなくし、記号や空白を取り除く
const STRIP = /[\s　・、，,。．.／/「」『』【】〔〕［］[\]（）()<>＜＞〈〉《》\-‐–—―_~〜～!！?？:：;；'"“”‘’`*＊#＃|｜×✕+＋&＆]/g;
export function norm(s) {
  return String(s || "").normalize("NFKC").toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(STRIP, "");
}
