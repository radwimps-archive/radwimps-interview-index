// assets/admin-history.js
// 「RADWIMPSの歩み」のページの「年表の管理」です。管理者モードの端末で、歩みのページを開いたときだけ読み込まれます（history.js）。
//   ・年表の出来事（data/history.csv）と、特設サイト（data/sites.csv）を、追加・修正・削除できます。
//   ・直した内容は、すぐ下の年表に反映されます（まだ GitHub には保存していない状態）。
//   ・「GitHub に保存」を押すと、GitHub の CSV が書き換わり、1〜2分でサイトに反映されます。
//   ・合鍵（アクセストークン）は、記事一覧の運営管理（記事の管理）で登録したものを、そのまま使います（github.js）。
//   ・合鍵がなくても「保存せずに試す」で試せます（直した CSV はファイルに書き出せます）。
//   ・出来事の「関連リンク」：記事一覧の記事を選んでつなぐか、ほかのページの URL を足します。「外す」で外せます（「関連リンク」の列）。

import { parseCSV, toCSVLine, parseHistory, parseSites, parseHistoryLinks, formatHistoryLinks, checkHistoryLinks, HISTORY_LINK_LABEL_MAX, HISTORY_CATEGORIES, SITE_KINDS } from "./data.js";
import { Table } from "./csv-table.js"; // 読み込んだ CSV と、まだ保存していない変更
import { h, downloadFile } from "./ui.js";
import { STORE_TOKEN, STORE_REPO, lsGet, lsSet, repoName, GhError, GitHub } from "./github.js";

const nf = (s) => String(s ?? "").normalize("NFKC").trim();
const oneLine = (s) => String(s ?? "").replace(/\s*\n\s*/g, " ").trim();

const T = {
  history: new Table({ file: "data/history.csv", what: "年表（data/history.csv）", label: "出来事", parse: parseHistory, newestFirst: false }),
  sites: new Table({ file: "data/sites.csv", what: "特設サイトの一覧（data/sites.csv）", label: "特設サイト", parse: parseSites, newestFirst: true })
};

/* ---------- 状態 ---------- */

const A = {
  root: null, opts: null,
  mode: "off",   // off：つないでいない　connecting：読み込み中　github：GitHub とつながっている　practice：保存せずに試す
  error: "", gh: null, saving: false,
  editing: null  // 編集中 { table: "history" | "sites", index: 何番目か（追加は null）, orig: もとの行の中身 }
};
const pending = () => T.history.counts().total + T.sites.counts().total;

let toastBox = null, toastTimer = 0;
function toast(msg) {
  if (!toastBox) { toastBox = h("div", { class: "toast", role: "status", "aria-live": "polite" }); document.body.append(toastBox); }
  toastBox.textContent = msg;
  toastBox.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastBox.classList.remove("show"), 3200);
}
// 確認ダイアログの代わり：1回目は知らせるだけで、3秒以内にもう一度押したら実行する（記事の管理と同じ）
function confirmInline(btn, msg) {
  if (btn.dataset.armed === "1") return true;
  btn.dataset.armed = "1";
  toast(msg);
  setTimeout(() => { btn.dataset.armed = ""; }, 3000);
  return false;
}
// GitHub 側が先に変わっていて、変更を重ねきれなかったときの知らせ
function reloadNote(t, lost, gone) {
  return (lost ? `${t.label}のうち ${lost} 件は、別の場所（GitHub など）で同じ行が先に直されていました。こちらで直した内容は新しい行として残してあるので、見比べて、いらないほうを消してください。` : "")
    + (gone ? `消すはずだった${t.label} ${gone} 件は、もう消えていたか、別の場所で直されていました（前の保存で、もう消してあった可能性もあります。消す変更は取りやめました）。` : "");
}
// 直した内容を、ページの年表に映す
const show = () => A.opts.rebuild(T.history.text(), T.sites.text());

/* ---------- GitHub ---------- */

async function connect(token, repo) {
  A.mode = "connecting"; A.error = "";
  render();
  try {
    A.gh = new GitHub(token, repo);
    await A.gh.init();
    for (const t of Object.values(T)) {
      const { text, sha } = await A.gh.read(t.file, t.what);
      const { lost, gone } = t.ops.length ? t.reload(text) : (t.load(text), { lost: 0, gone: 0 });
      t.sha = sha;
      if (lost || gone) toast(reloadNote(t, lost, gone) + "年表で確かめてから保存してください");
    }
    A.mode = "github";
    show(); // GitHub の最新の内容で年表を表示する（サイトへの反映を待っているあいだの変更も見える）
  } catch (e) {
    A.mode = "off";
    A.error = e instanceof GhError ? e.message : "読み込めませんでした。";
    if (e.keyProblem) lsSet(STORE_TOKEN, ""); // 使えない合鍵は、次に開いたときに使わない
  }
  render();
}
function startPractice() {
  // GitHub から読み込んだあと（保存で合鍵の問題が出たときなど）は、その内容と変更をそのまま使う。
  // まだ何も読み込んでいなければ、ページを開いたときに読んだ CSV（公開中のサイトのもの）から始める
  // 表ごとに見る（GitHub から片方だけ読めたときは、読めなかったほうだけ、ページを開いたときの CSV から）
  const src = A.opts.sourceTexts();
  if (!T.history.header.length && !src.history) { toast("年表を読み込めていません。ページを読み込み直してください"); return; }
  if (!T.history.header.length) T.history.load(src.history);
  if (!T.sites.header.length && src.sites) T.sites.load(src.sites);
  A.mode = "practice"; A.error = "";
  show(); // 年表を、この表の中身で作り直す（「直す」の行番号を、表とそろえるため）
  render();
}
async function save() {
  if (A.saving || A.mode !== "github" || !pending()) return;
  for (const t of Object.values(T)) {
    const errs = t.ops.length ? t.errors() : [];
    if (errs.length) { toast(`${t.label}に、直す必要がある問題が ${errs.length} 件あります（${errs[0].line} 行目：${errs[0].msg}）`); return; }
  }
  A.saving = true;
  render();
  const done = [];
  try {
    for (const t of Object.values(T)) {
      if (!t.ops.length) continue;
      const c = t.counts();
      const message = `${t.label === "出来事" ? "年表" : "特設サイトの一覧"}を更新（歩みのページから：追加 ${c.add}・修正 ${c.edit}・削除 ${c.delete}）`;
      let res = await A.gh.write(t.file, t.text(), t.sha, message);
      if (res.status === 409 || res.status === 422) {
        // 開いているあいだに GitHub 側で変わっていた：最新を読み込み、今回の変更を重ねてからもう一度保存する
        const { text, sha } = await A.gh.read(t.file, t.what);
        const { lost, gone } = t.reload(text); t.sha = sha;
        if (lost || gone) throw new GhError(reloadNote(t, lost, gone) + "年表で確かめてから、もう一度保存してください");
        res = await A.gh.write(t.file, t.text(), t.sha, message);
      }
      if (!res.ok) throw await A.gh.fail(res, t.what);
      t.sha = (await res.json()).content.sha;
      t.base = t.rows.map((r) => r.slice());
      t.ops = [];
      done.push(t.label);
    }
    toast("GitHub に保存しました。1〜2分でサイトに反映されます");
  } catch (e) {
    if (e.keyProblem) {
      lsSet(STORE_TOKEN, "");
      A.mode = "off";
      A.error = e.message + "（保存していない変更は、「ファイルに書き出す」で残せます）";
    }
    toast((done.length ? `${done.join("・")}は保存しました。` : "") + (e instanceof GhError ? e.message : "保存できませんでした。もう一度試してください"));
  }
  A.saving = false;
  show();
  render();
}
function exportCsv() {
  for (const t of Object.values(T)) if (t.ops.length) downloadFile(t.file.split("/").pop(), t.text(), "text/csv");
  toast("直した CSV を書き出しました。GitHub の data フォルダに上書きでアップロードすると反映されます");
}

/* ---------- 「年表の管理」の欄 ---------- */

export function mountHistoryAdmin(root, opts) {
  A.root = root; A.opts = opts;
  root.hidden = false;
  buildSheet();
  addEventListener("beforeunload", (e) => { if (pending()) { e.preventDefault(); e.returnValue = ""; } });
  const token = lsGet(STORE_TOKEN), repo = repoName(lsGet(STORE_REPO)) || repoName(opts.repo || "");
  if (token && repo) connect(token, repo); else render();
  return {
    // 年表の出来事の下の「直す」：line は data/history.csv の行番号、site は data/sites.csv の行番号
    editEvent(line) { if (ready()) openEditor("history", T.history.indexOfLine(line)); },
    editSite(line) { if (ready()) openEditor("sites", T.sites.indexOfLine(line)); }
  };
}
function ready() {
  if (A.mode === "github" || A.mode === "practice") return true;
  toast(A.mode === "connecting" ? "読み込んでいます。少し待ってから押してください" : "先に「保存せずに試す」を押すか、合鍵を登録してください");
  A.root.scrollIntoView({ block: "start", behavior: "smooth" });
  return false;
}

function render() {
  const root = { replaceChildren: (...kids) => A.root.replaceChildren(h("div", { class: "hadm-card" }, ...kids)) }; // 白いカードにのせる
  const head = h("div", { class: "hadm-head" },
    h("h2", { id: "histAdminTitle", text: "年表の管理" }),
    h("p", { class: "hadm-note", text: "管理者モードのこの端末だけに出ています。" }));
  if (A.mode === "connecting") return root.replaceChildren(head, h("p", { class: "hadm-msg", text: "GitHub から年表を読み込んでいます…" }));
  if (A.mode === "off") {
    const practice = h("button", { type: "button", class: "btn", text: "保存せずに試す" });
    practice.addEventListener("click", startPractice);
    const kids = [head];
    if (A.error) kids.push(h("p", { class: "hadm-msg err", role: "alert", text: A.error }));
    kids.push(
      h("p", { class: "hadm-msg" }, "GitHub に保存するには、",
        h("a", { href: "articles.html#admin", text: "記事一覧の運営管理" }),
        "の「記事の管理」で合鍵（アクセストークン）を登録してください。登録すると、このページでも自動でつながります。"),
      h("div", { class: "panelbtns" }, practice, pending() ? exportBtn() : null));
    return root.replaceChildren(...kids);
  }
  const status = A.mode === "github"
    ? h("p", { class: "hadm-msg" }, h("span", { class: "dot ok", "aria-hidden": "true" }), `GitHub につながっています（${A.gh.repo}・${A.gh.branch}）。下の年表は、GitHub の最新の内容です。`)
    : h("p", { class: "hadm-msg" }, h("span", { class: "dot", "aria-hidden": "true" }), "保存せずに試しています（変更は GitHub に保存されません）。");
  const addEvent = h("button", { type: "button", class: "btn primary", text: "＋ 出来事を追加" });
  addEvent.addEventListener("click", () => openEditor("history", null));
  const addSite = h("button", { type: "button", class: "btn", text: "＋ 特設サイトを追加" });
  addSite.addEventListener("click", () => openEditor("sites", null));
  // 特設サイトは、年表に出ていないもの（非表示）もあるので、一覧から選んで直せるようにする
  const pick = h("select", { class: "hadm-pick", "aria-label": "直す特設サイトを選ぶ" },
    h("option", { value: "", text: "特設サイトを選んで直す…" }),
    ...T.sites.rows.map((r, i) => h("option", { value: String(i), text: `${T.sites.cell(r, "年")} ${T.sites.cell(r, "名前")}${T.sites.cell(r, "状態") === "非表示" ? "（非表示）" : ""}` })));
  pick.addEventListener("change", () => { if (pick.value !== "") openEditor("sites", +pick.value); pick.value = ""; });
  root.replaceChildren(head, status,
    h("div", { class: "panelbtns" }, addEvent, addSite, pick),
    h("p", { class: "hadm-note", text: "出来事を直すときは、年表の出来事の下の「直す」を押します（MV のタブには出ません）。" }),
    pendingBar());
}
function exportBtn() {
  const b = h("button", { type: "button", class: "btn", text: "ファイルに書き出す" });
  b.addEventListener("click", exportCsv);
  return b;
}
function pendingBar() {
  const n = pending();
  if (!n) return h("p", { class: "hadm-pending", text: "保存していない変更はありません。" });
  const parts = Object.values(T).filter((t) => t.ops.length).map((t) => {
    const c = t.counts();
    return `${t.label}：追加 ${c.add}・修正 ${c.edit}・削除 ${c.delete}`;
  });
  const undo = h("button", { type: "button", class: "btn plain", text: "取り消す" });
  undo.addEventListener("click", () => {
    if (!confirmInline(undo, "もう一度押すと、保存していない変更をすべて取り消します")) return;
    for (const t of Object.values(T)) t.reset();
    show(); render(); toast("変更を取り消しました");
  });
  const btns = [undo];
  if (A.mode === "github") {
    const go = h("button", { type: "button", class: "btn primary", text: A.saving ? "保存しています…" : "GitHub に保存" });
    if (A.saving) go.disabled = true;
    go.addEventListener("click", save);
    btns.push(go);
  } else btns.push(exportBtn());
  return h("div", { class: "hadm-pending on" },
    h("p", null, h("b", { text: `保存していない変更 ${n} 件` }), h("span", { text: `（${parts.join("　")}）` })),
    h("div", { class: "panelbtns" }, ...btns));
}

/* ---------- 編集の画面（下から出る小窓。記事の管理と同じ形） ---------- */

const F = {};
let sheet = null;
const opt = (v, t = v) => h("option", { value: v, text: t });
const field = (label, control, hint) => h("label", { class: "admfield" }, label, control, hint ? h("small", { text: hint }) : null);
const dateInputs = (prefix, label) => {
  F[prefix + "y"] = h("input", { type: "text", inputmode: "numeric", maxlength: "4", autocomplete: "off", placeholder: "2026", "aria-label": `${label}の年` });
  F[prefix + "m"] = h("select", { "aria-label": `${label}の月` }, opt("", "—"), ...Array.from({ length: 12 }, (_, i) => opt(String(i + 1))));
  F[prefix + "d"] = h("select", { "aria-label": `${label}の日` }, opt("", "—"), ...Array.from({ length: 31 }, (_, i) => opt(String(i + 1))));
  return h("div", { class: "datein" }, F[prefix + "y"], h("span", { text: "年" }), F[prefix + "m"], h("span", { text: "月" }), F[prefix + "d"], h("span", { text: "日" }));
};

function buildSheet() {
  F.title = h("h2", { id: "hadmTitle", text: "" });
  F.form = h("form", { class: "fgroups editform", novalidate: "" });
  F.foot = h("div", { class: "sheet-foot" });
  const close = h("button", { type: "button", class: "btn plain", "data-act": "cancel", text: "閉じる" });
  sheet = h("div", { class: "sheet hadm-sheet", hidden: "" },
    h("div", { class: "sheet-back", "data-act": "cancel" }),
    h("div", { class: "sheet-in", role: "dialog", "aria-modal": "true", "aria-labelledby": "hadmTitle" },
      h("div", { class: "sheet-head" }, F.title, close), F.form, F.foot));
  document.body.append(sheet);

  // 出来事の欄
  F.ev = {};
  const ev = F.ev;
  ev.start = dateInputs("s", "日付");
  ev.end = dateInputs("e", "終わりの日付");
  ev.cat = h("select", { "aria-label": "主なカテゴリ" }, ...HISTORY_CATEGORIES.map((c) => opt(c.name)));
  ev.more = h("div", { class: "chips", role: "group", "aria-label": "ほかにも当てはまるカテゴリ" },
    ...HISTORY_CATEGORIES.map((c) => h("label", { class: "chip check" }, h("input", { type: "checkbox", value: c.name, "data-g": "more" }), c.name)));
  ev.text = h("textarea", { rows: "2" });
  ev.note = h("textarea", { rows: "2" });
  ev.site = h("input", { type: "url", inputmode: "url", autocomplete: "off", spellcheck: "false", placeholder: "https://" });
  ev.tower = h("input", { type: "text", autocomplete: "off", placeholder: "例：RADWIMPS 人間開花" });
  ev.video = h("textarea", { rows: "3", spellcheck: "false", placeholder: "例：MV「光」=https://www.youtube.com/watch?v=…" });
  ev.box = h("div", { class: "hadm-fields" },
    h("div", { class: "admfield" }, h("span", { text: "日付（年は必須。わかる所まで）" }), ev.start),
    h("div", { class: "admfield" }, h("span", { text: "終わりの日付（ツアーなど、期間のある出来事のとき）" }), ev.end),
    field("主なカテゴリ（年表の点の色）", ev.cat),
    h("div", { class: "fgroup" }, h("h3", { text: "ほかにも当てはまるカテゴリ（そのタブにも出ます）" }), ev.more),
    field("出来事（必須）", ev.text, "作品名・ライブ名を「」か『』で囲むと、いちばん初めのものが押せるリンクになります（下の「公式ページ」か「CD を探す」があるとき）。"),
    field("補足", ev.note, "出来事の下に小さく出ます。"),
    field("特設サイト・公式ページの URL", ev.site, "https:// で始まる URL。作品名・ライブ名を押すと開きます。"),
    field("CD を探す（タワーレコードの列）", ev.tower, "検索する言葉（例：RADWIMPS 人間開花）か、tower.jp の商品ページの URL。書くと、作品名を押したときに「CD を探す」が開きます。"),
    field("動画（1行に1つ）", ev.video, "「ラベル=YouTube の URL か ID」の形。ラベルを「MV」で始めると、MV のタブにも並びます（例：MV「光」=…、予告編=…）。"),
    buildLinkBox(ev));

  // 特設サイトの欄
  F.st = {};
  const st = F.st;
  st.state = h("div", { class: "chips", role: "radiogroup", "aria-label": "状態" },
    ...["公開", "非表示"].map((s) => h("label", { class: "chip check" }, h("input", { type: "radio", name: "hadmState", value: s }), s)));
  st.date = dateInputs("t", "日付");
  st.name = h("input", { type: "text", autocomplete: "off", placeholder: "例：Dear Jubilee -RADWIMPS TRIBUTE-" });
  st.kind = h("select", { "aria-label": "種類" }, ...SITE_KINDS.map((k) => opt(k.name)));
  st.url = h("input", { type: "url", inputmode: "url", autocomplete: "off", spellcheck: "false", placeholder: "https://" });
  st.closed = h("input", { type: "checkbox" });
  st.archive = h("input", { type: "url", inputmode: "url", autocomplete: "off", spellcheck: "false", placeholder: "https://web.archive.org/web/…" });
  st.note = h("textarea", { rows: "2" });
  st.id = h("input", { type: "text", autocomplete: "off", spellcheck: "false", placeholder: "空欄なら URL から自動で作ります" });
  st.box = h("div", { class: "hadm-fields" },
    h("div", { class: "fgroup" }, h("h3", { text: "状態" }), st.state),
    h("div", { class: "admfield" }, h("span", { text: "日付（作品の発売日・ライブの初日など。年は必須）" }), st.date),
    field("名前（必須）", st.name),
    field("種類", st.kind, "年表のどのカテゴリに出すかが決まります。"),
    field("URL（必須）", st.url),
    h("label", { class: "chip check hadm-closed" }, st.closed, "公開が終わった（「特設サイト（公開終了）」として保存版へつなぐ）"),
    field("保存版URL（Internet Archive）", st.archive, "公開が終わったサイトは、ここにつなぎます。"),
    field("メモ", st.note, "日付の根拠など。サイトには出ません。"),
    field("id", st.id, "今ある特設サイトの id は変えないでください。"));

  F.issues = h("div", { class: "editissues", "aria-live": "polite" });
  F.form.addEventListener("input", validate);
  F.form.addEventListener("change", validate);
  F.form.addEventListener("submit", (e) => e.preventDefault());
  sheet.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    if (act === "cancel") closeEditor();
    else if (act === "apply") applyEdit();
    else if (act === "delete") showDeleteConfirm();
    else if (act === "remove") removeRow();
    else if (act === "hide") { for (const r of st.state.querySelectorAll("input")) r.checked = r.value === "非表示"; applyEdit(); }
    else if (act === "back") renderFoot();
  });
  // Esc で閉じる（日本語の変換中の Esc では閉じない）
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden && !e.isComposing && e.keyCode !== 229) closeEditor(); });
}

/* ---------- 関連リンク（記事など） ---------- */
// 出来事の下に並ぶリンク。記事一覧の記事を探して「つなぐ」か、ほかのページのラベルと URL を書いて「足す」。つないだものは「外す」で外せる
let articleList = null; // 記事から選ぶときの、公開している記事（新しい順）。はじめて使うときに読む（読めなかったときは null のまま）
let articleAll = null;
let articleFailed = false; // 記事データを読めなかった（もう一度言葉を入れると読み直す）  // 状態で絞る前のすべての記事（つないだ記事が「非表示」などのとき、そう知らせるため）
const artText = new WeakMap();
const words = (v) => (Array.isArray(v) ? v.join(" ") : String(v ?? ""));
async function ensureArticles() {
  if (!articleList) {
    const items = A.opts.loadArticles ? await A.opts.loadArticles() : null;
    if (items) {
      articleAll = items;
      articleList = items.filter((it) => it.state === "公開" && it.url).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    }
  }
  return articleList;
}
function buildLinkBox(ev) {
  ev.links = [];
  ev.linkList = h("ul", { class: "hadm-links", "aria-label": "つないでいるリンク" });
  ev.artQ = h("input", { type: "search", autocomplete: "off", enterkeyhint: "search", placeholder: "例：人間開花 ナタリー" });
  ev.artHits = h("ul", { class: "hadm-hits", "aria-label": "見つかった記事", "aria-live": "polite" });
  ev.urlLabel = h("input", { type: "text", autocomplete: "off", maxlength: String(HISTORY_LINK_LABEL_MAX), placeholder: "例：公式ニュース", "aria-label": "リンクのラベル（出来事の下に出る文字）" });
  ev.urlUrl = h("input", { type: "url", inputmode: "url", autocomplete: "off", spellcheck: "false", placeholder: "https://", "aria-label": "リンクの URL" });
  const add = h("button", { type: "button", class: "btn", "data-lurl": "", text: "足す" });
  const box = h("div", { class: "fgroup hadm-linkbox" },
    h("h3", { text: "関連リンク（記事など。出来事の下に並びます）" }),
    ev.linkList,
    field("記事一覧の記事から選ぶ", ev.artQ, "タイトル・媒体・人の名前・日付（例：2016）で探せます。空白で区切ると、すべての言葉に合う記事だけ。「つなぐ」で足します。"),
    ev.artHits,
    h("div", { class: "admfield" }, h("span", { text: "ほかのページの URL を足す" }),
      h("div", { class: "hadm-urlrow" }, ev.urlLabel, ev.urlUrl, add),
      h("small", { text: `ラベルは出来事の下に出る文字です（例：公式ニュース、ライブレポート。${HISTORY_LINK_LABEL_MAX}文字まで）。https:// で始まる URL だけ使えます。` })));
  let timer = 0;
  ev.artQ.addEventListener("input", () => {
    clearTimeout(timer);
    renderHits(); // はじめてのときは「記事を読み込んでいます…」を先に出す
    timer = setTimeout(() => { articleFailed = false; ensureArticles().then((list) => { articleFailed = !list; renderHits(); }); }, 150);
  });
  box.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-lrm]"), ad = e.target.closest("[data-ladd]"), u = e.target.closest("[data-lurl]");
    if (rm) {
      const i = +rm.dataset.lrm;
      ev.links.splice(i, 1);
      renderLinks(); renderHits(); validate();
      // 外したボタンはなくなるので、次のリンクの「外す」か、記事を探す欄へ
      (ev.linkList.querySelectorAll("[data-lrm]")[Math.min(i, ev.links.length - 1)] || ev.artQ).focus();
      toast("リンクを外しました（まだ保存していません。下の「この内容にする」を押すと年表に映ります）");
    } else if (ad) {
      if (!ev.links.some((l) => l.type === "article" && l.id === ad.dataset.ladd)) ev.links.push({ type: "article", id: ad.dataset.ladd });
      renderLinks(); renderHits(); validate();
      ev.artQ.focus();
      toast("記事をつなぎました（まだ保存していません。下の「この内容にする」を押すと年表に映ります）");
    } else if (u) {
      const label = oneLine(ev.urlLabel.value).replace(/\|/g, " ").trim(), url = ev.urlUrl.value.trim();
      if (!label) { toast("ラベル（出来事の下に出る文字）を書いてください"); ev.urlLabel.focus(); return; }
      if (!/^https:\/\//.test(url)) { toast("URL は https:// で始まるものを書いてください"); ev.urlUrl.focus(); return; }
      if (!/^https:\/\/[^\s"<>|]+$/.test(url)) { toast("URL に、空白や「|」「\"」「<」「>」は使えません。URL を確かめてください"); ev.urlUrl.focus(); return; }
      if (ev.links.some((l) => l.type === "url" && l.url === url)) { toast("この URL は、もうつないであります（ラベルを変えるときは、外してから足し直してください）"); ev.urlUrl.focus(); return; }
      ev.links.push({ type: "url", label, url });
      ev.urlLabel.value = ""; ev.urlUrl.value = "";
      renderLinks(); validate();
      ev.urlLabel.focus();
      toast("リンクを足しました（まだ保存していません。下の「この内容にする」を押すと年表に映ります）");
    }
  });
  ev.linkBox = box;
  return box;
}
function linkText(l) {
  if (l.type === "url") return `${l.label}（${l.url}）`;
  if (l.type !== "article") return `書き方の正しくないリンク：${l.text}`;
  const it = articleAll && articleAll.find((x) => x.id === l.id);
  if (it) return `記事：${it.title}（${it.media}）${it.state === "公開" ? "" : `【${it.state}なので年表には出ません】`}`;
  return `記事：${l.id}（${articleAll ? "記事一覧に見つかりません" : articleFailed ? "記事を読み込めませんでした" : "読み込んでいます…"}）`;
}
function renderLinks() {
  const ev = F.ev;
  ev.linkList.replaceChildren(...(ev.links.length ? ev.links.map((l, i) => h("li", {},
    h("span", { text: linkText(l) }),
    h("button", { type: "button", class: "btn plain danger", "data-lrm": String(i), "aria-label": `「${linkText(l)}」を外す`, text: "外す" })))
    : [h("li", { class: "hadm-empty", text: "まだつないでいません。" })]));
}
function renderHits() {
  const ev = F.ev, q = nf(ev.artQ.value).toLowerCase();
  if (!q) { ev.artHits.replaceChildren(); return; }
  if (!articleList) { ev.artHits.replaceChildren(h("li", { class: "hadm-empty", text: articleFailed ? "記事の一覧を読み込めませんでした。言葉を入れ直すと、もう一度読み込みます。" : "記事を読み込んでいます…" })); return; }
  const ws = q.split(/\s+/).filter(Boolean);
  const have = new Set(ev.links.filter((l) => l.type === "article").map((l) => l.id));
  const textOf = (it) => {
    if (!artText.has(it)) artText.set(it, nf([it.title, it.media, words(it.members), words(it.guests), words(it.tags), it.eventName, it.date].join(" ")).toLowerCase());
    return artText.get(it);
  };
  const all = articleList.filter((it) => ws.every((w) => textOf(it).includes(w)));
  const hits = all.slice(0, 8);
  ev.artHits.replaceChildren(...(hits.length ? hits.map((it) => h("li", {},
    h("span", { class: "hadm-hit-text" }, h("small", { text: `${it.date || ""}　${it.media || ""}` }), it.title),
    have.has(it.id) ? h("span", { class: "hadm-hit-done", text: "つないであります" })
      : h("button", { type: "button", class: "btn", "data-ladd": it.id, "aria-label": `記事「${it.title}」をつなぐ`, text: "つなぐ" })))
    : [h("li", { class: "hadm-empty", text: "合う記事が見つかりませんでした。言葉を変えてみてください。" })]),
    ...(all.length > hits.length ? [h("li", { class: "hadm-empty", text: `ほかに ${all.length - hits.length} 件あります。言葉を足して絞ってください。` })] : []));
}

const setDate = (p, y, m, d) => { F[p + "y"].value = nf(y); F[p + "m"].value = nf(m) ? String(+nf(m)) : ""; F[p + "d"].value = nf(d) ? String(+nf(d)) : ""; };
const getDate = (p) => [nf(F[p + "y"].value), F[p + "m"].value, F[p + "d"].value];

function openEditor(table, index) {
  if (index !== null && index < 0) { toast("この行が見つかりませんでした。ページを読み込み直してください"); return; }
  // 閉じたあとに戻る場所（押したボタン。年表を作り直してもボタンを探し直せるよう、目印で覚える）
  const from = document.activeElement;
  A.returnTo = from && from.closest ? (from.matches("[data-hedit]") ? `[data-hedit="${from.dataset.hedit}"]`
    : from.matches("[data-sedit]") ? `[data-sedit="${from.dataset.sedit}"]` : from.matches(".hadm-pick") ? ".hadm-pick"
    : from.closest("#histAdmin") ? "#histAdmin button" : null) : null;
  const t = T[table], isNew = index === null;
  if (!t.header.length) { toast(`${t.label}の一覧を読み込めていないので、ここでは直せません。ページを読み込み直してください`); return; }
  const r = isNew ? null : t.rows[index];
  A.editing = { table, index, orig: r ? toCSVLine(r) : null };
  if (table === "history") {
    const ev = F.ev, c = (n) => (r ? t.cell(r, n) : "");
    setDate("s", r ? c("年") : String(new Date().getFullYear()), c("月"), c("日"));
    setDate("e", c("終了年"), c("終了月"), c("終了日"));
    const cats = c("カテゴリ").split(/[、,]/).map(nf).filter(Boolean);
    ev.cat.value = HISTORY_CATEGORIES.some((x) => x.name === cats[0]) ? cats[0] : HISTORY_CATEGORIES[0].name;
    for (const x of ev.more.querySelectorAll("input")) x.checked = cats.slice(1).includes(x.value);
    ev.text.value = c("出来事"); ev.note.value = c("補足"); ev.site.value = c("特設サイト"); ev.tower.value = c("タワーレコード");
    ev.video.value = c("動画").split("|").map((x) => x.trim()).filter(Boolean).join("\n");
    const lk = parseHistoryLinks(c("関連リンク"));
    ev.links = [...lk.links, ...lk.bad.map((text) => ({ type: "raw", text }))];
    ev.artQ.value = ""; ev.urlLabel.value = ""; ev.urlUrl.value = "";
    renderLinks(); renderHits();
    // 古い年表の CSV（「関連リンク」の列がない）では、足しても保存されないので、欄ごと出さない
    ev.linkBox.hidden = !t.header.includes("関連リンク");
    if (ev.links.some((l) => l.type === "article")) ensureArticles().then((list) => { articleFailed = !list; if (A.editing && A.editing.table === "history") { renderLinks(); validate(); } });
    F.form.replaceChildren(ev.box, F.issues);
    F.title.textContent = isNew ? "出来事を追加" : "出来事を直す";
  } else {
    const st = F.st, c = (n) => (r ? t.cell(r, n) : "");
    const state = c("状態") || "公開";
    for (const x of st.state.querySelectorAll("input")) x.checked = x.value === state;
    setDate("t", r ? c("年") : String(new Date().getFullYear()), c("月"), c("日"));
    st.name.value = c("名前"); st.kind.value = SITE_KINDS.some((k) => k.name === c("種類")) ? c("種類") : SITE_KINDS[0].name;
    st.url.value = c("URL"); st.closed.checked = c("公開終了") === "終了"; st.archive.value = c("保存版URL"); st.note.value = c("メモ");
    st.id.value = c("id") || c("ID"); st.id.readOnly = !isNew && !!st.id.value;
    F.form.replaceChildren(st.box, F.issues);
    F.title.textContent = isNew ? "特設サイトを追加" : "特設サイトを直す";
  }
  renderFoot();
  sheet.hidden = false;
  document.documentElement.classList.add("locked");
  // 小窓のうしろは、キーボードでも読み上げでも触れないようにする（フォーカスが小窓の外へ出ないように）
  for (const x of document.body.children) if (x !== sheet && !x.classList.contains("toast")) x.inert = true;
  F.form.scrollTop = 0;
  sheet.querySelector('.sheet-head [data-act="cancel"]').focus({ preventScroll: true });
}
function closeEditor() {
  sheet.hidden = true;
  document.documentElement.classList.remove("locked");
  for (const x of document.body.children) x.inert = false;
  A.editing = null;
  // 押したボタンへ戻る（年表を作り直したあとでも探せるよう、少し待ってから）
  const sel = A.returnTo;
  requestAnimationFrame(() => {
    const b = sel && document.querySelector(sel);
    if (b) { b.focus({ preventScroll: true }); b.scrollIntoView({ block: "nearest" }); }
    else if (A.root) { A.root.tabIndex = -1; A.root.focus({ preventScroll: true }); }
  });
}
function renderFoot() {
  const isNew = !A.editing || A.editing.index === null;
  F.foot.replaceChildren(
    isNew ? h("span") : h("button", { type: "button", class: "btn plain danger", "data-act": "delete", text: "削除" }),
    h("button", { type: "button", class: "btn primary", "data-act": "apply", text: isNew ? "追加する" : "この内容にする" }));
  validate();
}
function showDeleteConfirm() {
  const site = A.editing.table === "sites";
  F.foot.replaceChildren(
    h("p", { class: "hint", text: site ? "消すかわりに「非表示」にすると、年表には出さずに記録を残せます。" : "この出来事を年表から消します。" }),
    h("div", { class: "panelbtns" },
      h("button", { type: "button", class: "btn plain", "data-act": "back", text: "やめる" }),
      site ? h("button", { type: "button", class: "btn", "data-act": "hide", text: "非表示にする" }) : null,
      h("button", { type: "button", class: "btn danger", "data-act": "remove", text: "削除する" })));
}

// 入力した内容を、CSV の1行にする（知らない列は、もとの行のまま残す）
function formToCells() {
  const { table, index } = A.editing;
  const t = T[table];
  const base = index === null ? null : t.rows[index];
  let map;
  if (table === "history") {
    const ev = F.ev;
    const [y, m, d] = getDate("s"), [ey, em, ed] = getDate("e");
    const cats = [ev.cat.value, ...[...ev.more.querySelectorAll("input:checked")].map((x) => x.value).filter((n) => n !== ev.cat.value)];
    map = { "年": y, "月": m, "日": d, "終了年": ey, "終了月": em, "終了日": ed, "カテゴリ": cats.join("、"), "出来事": oneLine(ev.text.value),
      "補足": ev.note.value.trim(), "特設サイト": ev.site.value.trim(), "タワーレコード": ev.tower.value.trim(),
      "動画": ev.video.value.split("\n").map((x) => x.trim()).filter(Boolean).join(" | "), "関連リンク": formatHistoryLinks(ev.links) };
  } else {
    const st = F.st, sel = st.state.querySelector("input:checked");
    const [y, m, d] = getDate("t");
    map = { "状態": sel ? sel.value : "公開", "年": y, "月": m, "日": d, "名前": oneLine(st.name.value), "種類": st.kind.value, "URL": st.url.value.trim(),
      "公開終了": st.closed.checked ? "終了" : "", "保存版URL": st.archive.value.trim(), "メモ": st.note.value.trim(), "id": st.id.value.trim(), "ID": st.id.value.trim() };
  }
  return t.header.map((col, i) => (col in map ? String(map[col] ?? "") : base ? base[i] ?? "" : ""));
}
// サイトと同じ決まりでチェックする（特設サイトは、ほかの行と URL・id が重なっていないかも）
function validate() {
  if (!A.editing) return { errors: [] };
  const { table, index } = A.editing;
  const t = T[table];
  const cells = formToCells();
  const others = t.rows.filter((_, i) => i !== index);
  const text = t.text([...others, cells]);
  const { lines } = parseCSV(text);
  const line = lines[others.length + 1];
  const res = t.parse(text);
  const errors = res.errors.filter((x) => x.line === line).map((x) => x.msg);
  const warnings = res.warnings.filter((x) => x.line === line).map((x) => x.msg);
  if (table === "history") {
    // 記事データを読んであれば、つないだ記事が記事一覧にあるかも確かめる
    const ev = res.events.find((x) => x.line === line);
    if (ev && articleAll) warnings.push(...checkHistoryLinks([ev], articleAll).map((x) => x.msg));
    // URL を書いたまま「足す」を押していないと、そのリンクは残らないので、先に知らせる
    if (F.ev.urlUrl.value.trim() || F.ev.urlLabel.value.trim()) errors.push("「ほかのページの URL を足す」に書いた内容が、まだ足されていません。「足す」を押すか、欄を空にしてください");
  }
  F.issues.replaceChildren(...[
    ...errors.map((m) => h("p", { class: "msg err", text: "直してください：" + m })),
    ...warnings.map((m) => h("p", { class: "msg", text: "注意：" + m })),
    !errors.length && !warnings.length ? h("p", { class: "ok", text: "この内容は、書式のチェックを通ります。" }) : null].filter(Boolean));
  const apply = F.foot.querySelector('[data-act="apply"]');
  if (apply) apply.disabled = errors.length > 0;
  return { errors, cells };
}
function applyEdit() {
  const { errors, cells } = validate();
  if (errors.length) return;
  const { table, index, orig } = A.editing;
  const isNew = index === null;
  if (!T[table].doOp({ type: isNew ? "add" : "edit", orig, cells })) { closeEditor(); toast("変わったところがないので、そのままにしました"); return; }
  show(); render();
  // 戻り先：直した（足した）行の「直す」ボタン（日付を直して行が動いても、その行を探す）
  const t = T[table], idx = t.rows.findIndex((r) => toCSVLine(r) === toCSVLine(cells));
  const line = idx >= 0 ? parseCSV(t.text()).lines[idx + 1] : 0;
  if (line) A.returnTo = `[data-${table === "history" ? "hedit" : "sedit"}="${line}"]`;
  closeEditor();
  toast(`${T[table].label}を${isNew ? "追加" : "直"}しました（まだ保存していません。年表の上の「GitHub に保存」で保存します）`);
}
function removeRow() {
  const { table, orig } = A.editing;
  T[table].doOp({ type: "delete", orig, cells: null });
  A.returnTo = null; // 消した行のボタンはもうないので、年表の管理の欄へ戻る
  closeEditor();
  show(); render();
  toast(`${T[table].label}を削除しました（まだ保存していません）`);
}
