// assets/members.js
// 「メンバー・人物紹介」のページ（members.html）の動き。紹介文と SNS のリンクは members.html に直接書いてあります。
// ここでは、ほかのページと同じメニュー・ベータ版の表示・「誤りを知らせる」リンクを準備するだけです。

import { h, setupMenu, isAdminDevice } from "./ui.js";
import { feedbackUrl, hasFeedback, setupBeta, KIND } from "./feedback.js";

setupMenu();
setupBeta(document.querySelector("#main").firstElementChild);
if (hasFeedback) {
  document.querySelector(".site-footer .footer-links").append(
    h("a", { href: feedbackUrl({ kind: KIND.error, title: "人物紹介の誤りのお知らせ", page: "メンバー・人物紹介" }), target: "_blank", rel: "noopener noreferrer", text: "紹介の誤りを知らせる ↗" }));
}
if (isAdminDevice()) document.getElementById("adminLink").hidden = false;
