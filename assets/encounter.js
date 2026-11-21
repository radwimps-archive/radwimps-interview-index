// assets/encounter.js
// 玄関の「まだ読んでいない一節」の選び方（画面を使わない計算だけ。テスト tests/encounter.test.mjs からも使います）。
// 日本時間の日付から決まる番号で、まだ読んでいない記事の中から1本を選びます。
// 同じ日なら同じ1本（読んだら、次に開いたときは別の1本）。初めての人には、日替わりの1本と同じになります。

import { RELEASE_KIND } from "./data.js";

// 日本時間の今日の日付（例：2026-11-21）
export function todayKey(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
// 文字から番号を作る（同じ文字なら、いつでも同じ番号。FNV-1a という簡単な計算）
export function hashOf(text) {
  let x = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { x ^= text.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
  return x;
}
// 一節として出せる記事：公開中で、紹介文（説明）があり、リリース情報・参考資料ではないもの。順番は id でそろえる（並びが変わらないように）
export function candidatesOf(items) {
  return items
    .filter((it) => it.state === "公開" && it.id && it.summary && it.kind !== RELEASE_KIND && !/^参考資料/.test(it.note || ""))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
// まだ読んでいない記事から、今日の1本を選ぶ（全部読んでいたら null）
export function pickUnread(candidates, readIds, day) {
  const unread = candidates.filter((it) => !readIds.has(it.id));
  return unread.length ? unread[hashOf(day) % unread.length] : null;
}
