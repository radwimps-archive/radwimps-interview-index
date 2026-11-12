// assets/transfer.js
// 「あとで読む」「既読」を、ほかの端末に引き継ぐためのリンクを作る・読む処理です（会員登録なし）。
//
// しくみ：
//   記事の id の一覧を短く縮めて（圧縮）、サイトの URL の「#transfer=」のうしろに付けます。
//   「#」より後ろは、ブラウザからサーバーに送られないので、運営を含め、誰かに記録されることはありません。
//   リンクを別の端末で開くと、このブラウザに追加してよいかを確かめてから読み込みます。
// ※ 画面（ブラウザ）の部品は使わないので、node --test でもテストできます（tests/transfer.test.mjs）。

export const PREFIX = "#transfer=";

const toB64url = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = (text) => {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
const canZip = () => typeof CompressionStream === "function" && typeof DecompressionStream === "function";

// 引き継ぎの文字を作ります：encodeMarks({ later: [id…], read: [id…] }) → "z…"（圧縮）または "u…"（圧縮できないブラウザ）
export async function encodeMarks({ later = [], read = [] }) {
  const json = JSON.stringify({ v: 1, l: later, r: read });
  const bytes = new TextEncoder().encode(json);
  if (canZip()) return "z" + toB64url(await pipe(bytes, new CompressionStream("deflate-raw")));
  return "u" + toB64url(bytes);
}

// 引き継ぎの文字を読みます。読めないときは null。
export async function decodeMarks(code) {
  try {
    const kind = code[0], body = fromB64url(code.slice(1));
    let bytes;
    if (kind === "z") { if (!canZip()) return null; bytes = await pipe(body, new DecompressionStream("deflate-raw")); }
    else if (kind === "u") bytes = body;
    else return null;
    if (bytes.length > 500000) return null;
    const data = JSON.parse(new TextDecoder().decode(bytes));
    const ids = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && x.length > 0 && x.length < 160))] : []);
    if (!data || data.v !== 1) return null;
    return { later: ids(data.l), read: ids(data.r) };
  } catch {
    return null;
  }
}
