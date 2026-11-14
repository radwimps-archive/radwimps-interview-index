// assets/search.js
// 「RAD LIVE SET LIST」の検索窓で使う、ゆるい（曖昧な）一致の判定です。
//   1. 文字をそろえる：全角半角・大文字小文字・ひらがなとカタカナの違い・空白や記号をなくす
//   2. 英語の言葉をひらがなで入れたときのために、よく出る言葉（ツアー・ライブ・フェスなど）は読みで言い換える
//   3. それでも合わないときは、英語とひらがなの「子音だけの形」で比べる（例：「ふぉーえばー」と「FOREVER」）
//      （母音と r・l は、書き方が人によってちがうので外して比べます。3文字以上のときだけ使います）

const SKIP = /[\s　ー・\-_.,'’"“”「」『』()（）【】!！?？:：;；、。〜～~&＆/／*＊+＋]/g;

// 検索用にそろえた文字（ひらがな・小文字・記号なし）
export function fold(s) {
  return String(s ?? "").normalize("NFKC").toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(SKIP, "");
}

// よく出る英語の言葉の読み（読み → 英語）。長い読みを先に置く
const WORDS = [
  ["あにばーさりー", "anniversary"], ["あにばーさりい", "anniversary"], ["ふぇすてぃばる", "festival"], ["こんさーと", "concert"],
  ["すぺしゃる", "special"], ["ふぉーえばー", "forever"], ["ひゅーまん", "human"], ["ぐらんぷり", "grandprix"], ["ぱーてぃー", "party"],
  ["わーるど", "world"], ["じゃぱん", "japan"], ["よーろっぱ", "europe"], ["あめりか", "america"], ["おーすとらりあ", "australia"],
  ["ぶるーむ", "bloom"], ["ふぇす", "fes"], ["つあー", "tour"], ["らいぶ", "live"], ["ろっく", "rock"], ["あじあ", "asia"],
  ["でいず", "daze"], ["ばっく", "back"], ["はうす", "house"], ["ふぁん", "fan"], ["くらぶ", "club"], ["ないと", "night"],
  ["みゅーじっく", "music"], ["すてーじ", "stage"], ["ほーる", "hall"], ["ぷらす", "plus"], ["ふぃるむ", "film"], ["いりおん", "illion"], ["いん", "in"],
];
const WORDS_FOLDED = WORDS.map(([k, e]) => [fold(k), fold(e)]);

const KANA_CLASS = (() => {
  const m = new Map();
  const set = (chars, cls) => { for (const c of chars) m.set(c, cls); };
  set("かきくけこがぎぐげご", "k");
  set("さしすせそざじずぜぞちぢ", "s"); // し・ち・じ は sh・ch・j の音なので s にそろえる
  set("たてとだでどつづ", "t");
  set("なにぬねのまみむめもん", "n");
  set("はひふへほばびぶべぼぱぴぷぺぽゔ", "p");
  return m;
})();
const LATIN_CLASS = { b: "p", p: "p", v: "p", f: "p", h: "p", k: "k", g: "k", q: "k", c: "k", s: "s", z: "s", x: "s", j: "s", t: "t", d: "t", n: "n", m: "n" };

// 「子音だけの形」。英語もひらがなも同じ文字（k・s・t・n・p）に直す。漢字・数字はそのまま
export function skeleton(s) {
  const t = String(s ?? "").normalize("NFKC").toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(SKIP, "")
    .replace(/sh|ch|th/g, "s").replace(/ts/g, "t").replace(/ph/g, "p").replace(/ck/g, "k");
  let out = "";
  for (const c of t) {
    const k = KANA_CLASS.get(c) || LATIN_CLASS[c];
    if (k) { if (out[out.length - 1] !== k) out += k; continue; }
    if (/[a-zぁ-ゟ]/.test(c)) continue; // 母音・r・l・y・w・小さい文字・あ行・や行・ら行・わ行は外す
    out += c;
  }
  return out;
}

// text が query に（ゆるく）合うか
export function looseMatch(text, query) {
  const q = fold(query);
  if (!q) return true;
  const t = fold(text);
  if (t.includes(q)) return true;
  // 英語の言葉をひらがなで入れたとき
  let qe = q;
  for (const [k, e] of WORDS_FOLDED) if (qe.includes(k)) qe = qe.split(k).join(e);
  if (qe !== q && t.includes(qe)) return true;
  // 子音だけの形（3文字以上のときだけ）
  const sq = skeleton(query);
  return sq.length >= 3 && skeleton(text).includes(sq);
}

// 検索窓に入れた文字を、空白で分けた「すべての言葉に合うか」（例：「ふぉーえばー 2022」）
export function looseMatchAll(text, query) {
  const parts = String(query ?? "").normalize("NFKC").split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return looseMatch(text, query);
  return looseMatch(text, query) || parts.every((p) => looseMatch(text, p));
}
