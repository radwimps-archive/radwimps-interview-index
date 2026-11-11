// assets/maker.js
// 記事データ作成ツール（maker.html）の動きです。入力した内容から、data/articles.csv に貼り付ける1行を作ります。
// ※ 安全のため、HTML の中にスクリプトを直接書かず、このファイルに書きます（運用マニュアルの「安全のための決まり」）。

import { KIND_ORDER, MEMBERS, MEMBER_ORDER, LANGS, STATES, CATEGORIES, ARTICLE_HEADER, VIDEO_KIND, INTERVIEW_KIND, toCSVLine, parseArticles, youtubeId } from "./data.js";

const $ = (s) => document.querySelector(s);
const opt = (sel, values, first) => {
  if (first !== undefined) sel.append(new Option(first, ""));
  for (const v of values) sel.append(new Option(v, v));
};
opt($("#state"), STATES);
opt($("#m"), Array.from({ length: 12 }, (_, i) => String(i + 1)), "—");
opt($("#d"), Array.from({ length: 31 }, (_, i) => String(i + 1)), "—");
opt($("#kind"), KIND_ORDER);
opt($("#lang"), Object.keys(LANGS));
for (const key of MEMBER_ORDER) {
  const label = document.createElement("label");
  const box = Object.assign(document.createElement("input"), { type: "checkbox", value: MEMBERS[key].name, id: "w-" + key });
  label.htmlFor = box.id;
  label.append(box, MEMBERS[key].name);
  $("#members").append(label);
}
// カテゴリ（記事が生まれたきっかけ）はいくつでも選べる
for (const c of CATEGORIES) {
  const label = document.createElement("label");
  const box = Object.assign(document.createElement("input"), { type: "checkbox", value: c.name, id: "c-" + c.slug });
  label.htmlFor = box.id;
  label.title = c.desc;
  label.append(box, c.name);
  $("#cats").append(label);
}
$("#header").textContent = toCSVLine(ARTICLE_HEADER);

// 月を選ぶまで日は選べない／その月にない日は選べない
function syncDays() {
  const m = Number($("#m").value);
  $("#d").disabled = !m;
  if (!m) { $("#d").value = ""; return; }
  const y = /^\d{4}$/.test($("#y").value) ? Number($("#y").value) : 2000;
  const max = new Date(y, m, 0).getDate();
  for (const o of $("#d").options) if (o.value) o.disabled = Number(o.value) > max;
  if (Number($("#d").value) > max) $("#d").value = "";
}

function update() {
  const y = $("#y").value.normalize("NFKC").replace(/\D/g, "").slice(0, 4);
  if (y !== $("#y").value) $("#y").value = y;
  syncDays();
  const members = [...document.querySelectorAll("#members input:checked")].map((b) => b.value).join("、");
  const cats = [...document.querySelectorAll("#cats input:checked")].map((b) => b.value).join("、");
  const tags = $("#tags").value.trim();
  const cells = [$("#state").value, y, $("#m").value, $("#d").disabled ? "" : $("#d").value, $("#media").value.trim(), $("#kind").value, cats,
    $("#title").value.trim(), $("#url").value.trim(), members, $("#guests").value.trim(), tags, $("#lang").value, $("#note").value.trim(),
    $("#summary").value.replace(/\s*\n\s*/g, " ").trim(), $("#eventDate").value.trim(), $("#eventName").value.trim(), $("#venue").value.trim(), $("#id").value.trim()];
  const line = toCSVLine(cells);
  $("#line").value = line;
  // サイトと同じルールでチェックする
  const res = parseArticles(toCSVLine(ARTICLE_HEADER) + "\n" + line + "\n");
  const list = $("#issues");
  list.replaceChildren(
    ...res.errors.map((e) => Object.assign(document.createElement("li"), { className: "e", textContent: "直してください：" + e.msg })),
    ...res.warnings.map((w) => Object.assign(document.createElement("li"), { className: "w", textContent: "注意：" + w.msg }))
  );
  $("#ok").hidden = !!res.errors.length;
  $("#copy").disabled = !!res.errors.length;
}

// YouTube の URL を入れたら、種類を「動画」に、媒体が空なら「YouTube」にする（あとから変えられます）
$("#url").addEventListener("input", () => {
  if (!youtubeId($("#url").value.trim())) return;
  if ($("#kind").value === INTERVIEW_KIND) $("#kind").value = VIDEO_KIND;
  if (!$("#media").value.trim()) $("#media").value = "YouTube";
});

// 送信（Enter キーなど）でページが読み込み直されないようにする
document.querySelector(".form").addEventListener("submit", (e) => e.preventDefault());

// 日本語入力の変換中は待ってから更新する
document.querySelector(".form").addEventListener("input", (e) => { if (!e.isComposing) update(); });
document.querySelector(".form").addEventListener("compositionend", update);
document.querySelector(".form").addEventListener("change", update);
$("#copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("#line").value);
    $("#copyMsg").textContent = "コピーしました。articles.csv の2行目（見出しのすぐ下）に貼り付けてください。";
  } catch {
    $("#line").select();
    $("#copyMsg").textContent = "自動でコピーできませんでした。選択された文字をコピーしてください。";
  }
});
$("#clear").addEventListener("click", () => {
  $(".form").reset();
  $("#copyMsg").textContent = "";
  update();
});
update();
