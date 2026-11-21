// assets/marks.js
// 記事の印（お気に入り・あとで読む・既読）を、このブラウザ（localStorage）に読み書きする関数です。
// 「あなたの棚」（shelf.js）・楽曲一覧（songs.js）・メンバー紹介（members.js）で同じものを使います。
// 保存場所と形は、記事一覧（assets/app.js の cleanMarks・setMark）と同じです。片方だけ変えると印がずれるので、変えるときは両方を直してください。

export const STORE_MARKS = "radwimps-interview-index:marks"; // fv お気に入り・lt あとで読む・rd 既読・bm 以前の「お気に入り（★）」

export const readJSON = (key) => { try { const v = JSON.parse(localStorage.getItem(key)); return v && typeof v === "object" ? v : {}; } catch { return {}; } };
export const writeJSON = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; } };
export const idsOf = (o) => new Set(o && typeof o === "object" ? Object.keys(o).filter((k) => o[k] && k.length < 160) : []);

// 印を読む（毎回、保存場所から読み直す。別のタブで変えた印も入る）
export function loadMarks() {
  const m = readJSON(STORE_MARKS);
  // 以前の「お気に入り（★）」は、記事一覧と同じく「あとで読む」として扱う
  return { fv: idsOf(m.fv), lt: new Set([...idsOf(m.lt), ...idsOf(m.bm)]), rd: idsOf(m.rd) };
}

// 印を付ける・外す（ほかの印はそのまま残す）。書く直前に読み直すので、別のタブの変更を上書きしない
// 保存できたら true（プライベートブラウズなどで保存できないときは false）
export function setMark(kind, id, on) {
  const m = readJSON(STORE_MARKS);
  for (const k of ["fv", "lt", "rd", "bm"]) if (!m[k] || typeof m[k] !== "object") m[k] = {};
  if (on) m[kind][id] = 1; else delete m[kind][id];
  if (kind === "lt" && !on) delete m.bm[id]; // 以前の「お気に入り（★）」に残っていると、記事一覧で「あとで読む」に戻ってしまうため
  return writeJSON(STORE_MARKS, m);
}
