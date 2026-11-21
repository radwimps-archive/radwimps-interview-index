// assets/members.js
// 「メンバー紹介」のページ（members.html）の動き。紹介文と SNS のリンクは members.html に直接書いてあります。
// ここでは、ほかのページと同じメニュー・ベータ版の表示・「誤りを知らせる」リンクを準備します。
// また、記事のある人の紹介には「記事をここで見る」の欄を足します。開くと、その人の記事が新しい順に5件（並び順と数は利用者が選べる）、
// ♡（お気に入り）と「あとで読む」のボタン付きで並びます（押すと「あなたの棚」に入る。assets/room-articles.js）。
// どの記事を出すかは、紹介の下の「○○の記事を見る」（記事一覧の ?person=名前）と同じ「本人が語っている記事」です。

import "./analytics.js";
import { h, setupMenu, isAdminDevice } from "./ui.js";
import { feedbackUrl, hasFeedback, setupBeta, KIND } from "./feedback.js";
import { parseArticles } from "./data.js";
import { personSelf, pickArticles } from "./shelf-data.js";
import { roomArticles, setupRoomArticles } from "./room-articles.js";

setupMenu();
setupBeta(document.querySelector("#main").firstElementChild);
if (hasFeedback) {
  document.querySelector(".site-footer .footer-links").append(
    h("a", { href: feedbackUrl({ kind: KIND.error, title: "メンバー紹介の誤りのお知らせ", page: "メンバー紹介" }), target: "_blank", rel: "noopener noreferrer", text: "紹介の誤りを知らせる ↗" }));
}
if (isAdminDevice()) document.getElementById("adminLink").hidden = false;

const people = document.getElementById("people");
setupRoomArticles(people);

(async () => {
  try {
    const r = await fetch("data/articles.csv", { cache: "no-cache" });
    if (!r.ok) throw new Error(`data/articles.csv: HTTP ${r.status}`);
    const items = parseArticles(await r.text()).items;
    for (const link of people.querySelectorAll(".person-card a.person-articles")) {
      const url = new URL(link.href);
      const name = url.searchParams.get("person");
      if (!name) continue;
      // 下の欄には動画・ラジオも出るので、「○○の記事を見る」も「すべて」のタブで開く（楽曲一覧の「記事 ○件」と同じ）
      url.searchParams.set("format", "all");
      link.setAttribute("href", "articles.html" + url.search);
      const list = pickArticles(items, (it) => personSelf(it, name));
      if (!list.length) continue;
      // 開くまでは閉じておく（紹介文が読みにくくならないように）
      link.before(h("details", { class: "person-picks" },
        h("summary", null, h("span", { text: `記事をここで見る（${list.length}件）` }), h("span", { class: "chev", "aria-hidden": "true", text: "⌄" })),
        roomArticles(list, { label: `${name}の記事` })));
    }
  } catch (e) {
    // 読み込めなくても、紹介と「○○の記事を見る」はそのまま使える
    console.error(e);
  }
})();
