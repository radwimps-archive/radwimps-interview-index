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

// 曲・作品のまとまりに入れるときの優先の順（同じグループの中は、記事一覧の「曲・作品から探す」の並び順）
const GROUP_PRIORITY = ["曲", "アルバム・EP", "映画", "ドラマ・CM"];
const WORKS_BY_PRIORITY = [...WORKS].sort((a, b) => (GROUP_PRIORITY.indexOf(a.group) + 99) % 99 - (GROUP_PRIORITY.indexOf(b.group) + 99) % 99);

const byNewest = (a, b) => (b.date || "").localeCompare(a.date || "") || a.title.localeCompare(b.title, "ja");

// 記事を分ける。mode：person（人ごと）・work（曲・作品ごと）・year（年代ごと）・live（ライブごと）
// 返すもの：[{ name: 見出し, items: [記事…] }…]。1つの記事は、どれか1つのまとまりにだけ入る（同じ記事が何度も出ないように。運営の決定 11/21）
// どこにも入らない記事は、最後の「そのほか」にまとめる
export function groupArticles(items, mode) {
  const groups = new Map();
  const add = (name, it) => { if (!groups.has(name)) groups.set(name, []); groups.get(name).push(it); };
  const rest = [];
  let order = [];
  if (mode === "person") {
    // 1つの記事は1か所だけ：「メンバー」欄に最初に書かれている人のまとまりへ（対談相手のまとまりは作らない）
    order = MEMBER_ORDER.map((k) => MEMBERS[k].name);
    for (const it of items) { if (it.members.length) add(MEMBERS[it.members[0]].name, it); else rest.push(it); }
  } else if (mode === "work") {
    // 1つの記事は1か所だけ：いくつかの作品にあてはまるときは、曲 → アルバム・EP → 映画 → ドラマ・CM の順で先にあてはまったものへ
    order = WORKS_BY_PRIORITY.map((w) => w.name);
    for (const it of items) {
      const hit = WORKS_BY_PRIORITY.find((w) => workMatch(it, w.name));
      if (hit) add(hit.name, it); else rest.push(it);
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
  // 決まった順（メンバー・作品の一覧の順）にないものは、記事の多い順に後ろへ
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

// 楽曲一覧・メンバー紹介に出す「この曲の記事」「この人の記事」のための計算（棚に入れるボタン付きの短い一覧。assets/room-articles.js）

// 人の記事か：記事一覧の ?person=名前 を開いたときと同じ「本人が語っている記事」（メンバー欄、メンバーでない人は対談相手の欄にいる）
const MEMBER_KEY = Object.fromEntries(MEMBER_ORDER.map((k) => [MEMBERS[k].name, k]));
export function personSelf(it, name) {
  const key = MEMBER_KEY[name];
  return key ? it.members.includes(key) : it.guests.includes(name);
}

// 公開中の記事のうち、条件に合うものを新しい順に（日付のない記事は最後）。
// 同じ日付の記事は、記事一覧の「新しい順」と同じく data/articles.csv の順のまま（日付だけで比べる。sort は元の順を保つ）
export function pickArticles(items, test) {
  return items.filter((it) => it.state === "公開" && it.id && test(it)).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

// 並び順を変える（楽曲一覧・メンバー紹介の短い一覧で、利用者が選ぶ）。list は pickArticles の結果（新しい順）
// order：new（新しい順）・old（古い順）。どちらも日付のない記事は最後、同じ日付は CSV の順のまま
export function orderArticles(list, order) {
  if (order !== "old") return list;
  return [...list].sort((a, b) => (!a.date) - (!b.date) || (a.date || "").localeCompare(b.date || ""));
}
