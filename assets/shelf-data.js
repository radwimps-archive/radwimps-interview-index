// assets/shelf-data.js
// 「あなたの棚」（shelf.html）で、棚の中身を人・曲や作品・年代・ライブごとに分けるための計算です。
// 画面を使わない計算だけを置きます（テスト tests/shelf.test.mjs からも使います）。
// 分け方は、記事一覧の「人から探す」「曲・作品から探す」と同じ決まりです（記事に付いたメンバー・対談相手・タグ・タイトル・説明で決まる）。

import { MEMBERS, MEMBER_ORDER, WORKS, LIVE_KIND } from "./data.js";
import { norm } from "./text.js";
export { norm };

// 曲・作品の記事か（記事一覧の workMatch と同じ）：タグにその名前がある、タイトルや説明に「」『』付きで出てくる、または長めの名前がそのまま出てくる
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function workMatch(it, name) {
  const n = norm(name);
  if (!n) return false;
  if (it.tags.some((t) => norm(t) === n)) return true;
  const quoted = new RegExp(`[「『“"]${reEsc(name)}[」』”"]`);
  if (quoted.test(it.title) || quoted.test(it.summary)) return true;
  return [...n].length >= 4 && norm([it.title, it.summary, it.tags.join(" "), it.eventName].join(" ")).includes(n);
}

const byNewest = (a, b) => (b.date || "").localeCompare(a.date || "") || a.title.localeCompare(b.title, "ja");

// 記事を分ける。mode：person（人ごと）・work（曲・作品ごと）・year（年代ごと）・live（ライブごと）
// 返すもの：[{ name: 見出し, items: [記事…] }…]。1つの記事が、いくつかのまとまりに入ることもある（例：2人の対談は、2人のどちらにも出る）
// どこにも入らない記事は、最後の「そのほか」にまとめる
export function groupArticles(items, mode) {
  const groups = new Map();
  const add = (name, it) => { if (!groups.has(name)) groups.set(name, []); groups.get(name).push(it); };
  const rest = [];
  let order = [];
  if (mode === "person") {
    order = MEMBER_ORDER.map((k) => MEMBERS[k].name);
    for (const it of items) {
      const names = [...it.members.map((k) => MEMBERS[k].name), ...it.guests];
      if (!names.length) rest.push(it);
      for (const n of new Set(names)) add(n, it);
    }
  } else if (mode === "work") {
    order = WORKS.map((w) => w.name);
    for (const it of items) {
      const hit = WORKS.filter((w) => workMatch(it, w.name));
      if (!hit.length) rest.push(it);
      for (const w of hit) add(w.name, it);
    }
  } else if (mode === "year") {
    for (const it of items) { if (it.date) add(`${it.date.slice(0, 4)}年`, it); else rest.push(it); }
    order = [...groups.keys()].sort().reverse();
  } else if (mode === "live") {
    // 記事一覧の「ライブから探す」と同じく、ライブレポートだけをライブ名ごとに。ライブ名がまだないものは「ライブ名を確認中」
    for (const it of items) {
      if (it.kind !== LIVE_KIND) rest.push(it);
      else add(it.eventName || "ライブ名を確認中", it);
    }
    // 公演日の新しいライブから
    const latest = (name) => groups.get(name).reduce((m, it) => ((it.eventDate || "") > m ? it.eventDate : m), "");
    order = [...groups.keys()].sort((a, b) => latest(b).localeCompare(latest(a)) || a.localeCompare(b, "ja"));
  }
  // 決まった順（メンバー・作品の一覧の順）にないもの（対談相手など）は、記事の多い順に後ろへ
  const known = order.filter((n) => groups.has(n));
  const extra = [...groups.keys()].filter((n) => !known.includes(n)).sort((a, b) => groups.get(b).length - groups.get(a).length || a.localeCompare(b, "ja"));
  const out = [...known, ...extra].map((name) => ({ name, items: groups.get(name).sort(byNewest) }));
  if (rest.length) out.push({ name: mode === "live" ? "ライブレポート以外" : "そのほか", items: rest.sort(byNewest) });
  return out;
}

// 行った公演を、ライブ名ごとに分ける（新しい公演のあるライブから。公演は新しい順）
export function groupLives(lives) {
  const groups = new Map();
  for (const l of lives) { if (!groups.has(l.name)) groups.set(l.name, []); groups.get(l.name).push(l); }
  return [...groups.entries()]
    .map(([name, list]) => ({ name, items: list.sort((a, b) => b.date.localeCompare(a.date)) }))
    .sort((a, b) => b.items[0].date.localeCompare(a.items[0].date));
}
