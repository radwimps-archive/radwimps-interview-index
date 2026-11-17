// assets/search.js
// 「RAD LIVE SET LIST」の検索窓で使う、ゆるい（曖昧な）一致の判定です。
//   1. 文字をそろえる：全角半角・大文字小文字・ひらがなとカタカナの違い・空白や記号をなくす
//   2. 英語の言葉をひらがなで入れたときのために、よく出る言葉（ツアー・ライブ・フェスなど）は読みで言い換える
//   3. ひらがなで入れたときは、ローマ字に直した「音の形」でも比べる（例：「ふじろっく」と「FUJI ROCK」、「ろっきん」と「ROCK IN」）

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
  ["かうんとだうん", "countdown"], ["さまーそにっく", "summersonic"], ["さまそに", "summersonic"], ["らいじんぐさん", "risingsun"], ["らじおくれいじー", "radiocrazy"],
  ["すとろべりー", "strawberry"], ["ろっきん", "rockin"], ["ふじ", "fuji"], ["めとろっく", "metrock"], ["じぇねれーしょん", "generation"],
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

// ひらがな → ローマ字（ヘボン式に近い形。「ふじろっく」→ fujirokku）
const KANA1 = {
  あ: "a", い: "i", う: "u", え: "e", お: "o", か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko", が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so", ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo", た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do", な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no", は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo", ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po", ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo", ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro", わ: "wa", を: "o", ん: "n", ゔ: "vu",
  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o", ゃ: "ya", ゅ: "yu", ょ: "yo",
};
// 小さい「ゃゅょぁぃぅぇぉ」がついたときは、前の文字の子音＋小さい文字の母音（きゃ→kya、ふぁ→fa、てぃ→ti、じゃ→ja）
function romaji(s) {
  let out = "", dbl = false;
  const chars = [...s];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i], nx = chars[i + 1];
    if (c === "っ") { dbl = true; continue; }
    let r = KANA1[c];
    if (r === undefined) { out += c; dbl = false; continue; }
    if (nx && "ゃゅょぁぃぅぇぉ".includes(nx) && r.length > 1) {
      const v = KANA1[nx];
      const head = r.replace(/[aiueo]$/, "");
      r = "ゃゅょ".includes(nx) ? (/^(sh|ch|j)$/.test(head) ? head + v.slice(1) : head + v) : (head === "ts" ? "ts" : head === "sh" ? "sh" : head === "ch" ? "ch" : head.replace(/y$/, "")) + v;
      if ("ぃ".includes(nx) && /^[td]$/.test(head)) r = head + "i"; // てぃ→ti、でぃ→di
      i++;
    }
    if (dbl) { out += r[0]; dbl = false; }
    out += r;
  }
  return out;
}
// 音の形：英語の綴りとローマ字の違いをならす（ck→k、l→r、v→b など）。続けて同じ文字は1つに。
// 日本語で子音のあとに足される u・o（rokku の u、rock の o など）は、子音にはさまれたところと語末で外す
export function soundKey(s) {
  return romaji(fold(s))
    .replace(/[^a-z0-9]/g, "")
    .replace(/ck/g, "k").replace(/c(?=[eiy])/g, "s").replace(/c/g, "k").replace(/q/g, "k").replace(/x/g, "ks").replace(/ph/g, "f")
    .replace(/l/g, "r").replace(/v/g, "b").replace(/wh/g, "w").replace(/th/g, "s").replace(/tsu/g, "tu").replace(/shi/g, "si").replace(/chi/g, "ti").replace(/sh/g, "s").replace(/ch/g, "t")
    .replace(/(.)\1+/g, "$1")
    .replace(/([^aiueo0-9])[uo](?=[^aiueo0-9]|$)/g, "$1");
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
  // ひらがなで入れたときは、ローマ字の音の形で比べる（「ふじろっく」→ FUJI ROCK、「ろっきん」→ ROCK IN）
  // （以前の「子音だけの形」は、関係ないライブまで合ってしまうので、ここでは使わない）
  if (!/[ぁ-ゖ]/.test(q) || !/^[ぁ-ゖa-z0-9]+$/.test(q) || [...q].length < 3) return false; // 漢字まじりは、そのまま比べる
  // 言葉の頭から比べる（「WEATHER KING」の途中の rking に「ろっきん」が合わないように）
  const words = String(text ?? "").normalize("NFKC").split(/[\s　・\/／,、（）()「」『』"'’!！?？:：\-]+/).filter(Boolean);
  const keys = [soundKey(query), soundKey(qe)].filter((k) => k.length >= 3);
  for (let i = 0; i < words.length; i++) {
    const kt = soundKey(words.slice(i, i + 4).join(""));
    if (keys.some((k) => kt.startsWith(k))) return true;
  }
  return false;
}

// 検索窓に入れた文字を、空白で分けた「すべての言葉に合うか」（例：「ふぉーえばー 2022」）
export function looseMatchAll(text, query) {
  const parts = String(query ?? "").normalize("NFKC").split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return looseMatch(text, query);
  return looseMatch(text, query) || parts.every((p) => looseMatch(text, p));
}
