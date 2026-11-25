// assets/admin-history.js
// 「RADWIMPSの歩み」のページの「年表の管理」です。管理者モードの端末で、歩みのページを開いたときだけ読み込まれます（history.js）。
//   ・年表の出来事（data/history.csv）と、特設サイト（data/sites.csv）を、追加・修正・削除できます。
//   ・直した内容は、すぐ下の年表に反映されます（まだ GitHub には保存していない状態）。
//   ・「GitHub に保存」を押すと、GitHub の CSV が書き換わり、1〜2分でサイトに反映されます。
//   ・合鍵（アクセストークン）は、記事一覧の運営管理（記事の管理）で登録したものを、そのまま使います（github.js）。
//   ・合鍵がなくても「保存せずに試す」で試せます（直した CSV はファイルに書き出せます）。
//   ・出来事の「タグ」：検索のための言葉を「足す」「✕」で付け外しします（「タグ」の列。年表には出さず、歩みの検索窓で見つかるようになる）。
//   ・出来事の「関連リンク」：記事一覧の記事を選んでつなぐか、ほかのページの URL を足します。「外す」で外せます（「関連リンク」の列）。

import { parseCSV, toCSVLine, parseHistory, parseSites, parseSetlists, historyShows, quotedNames, SETLIST_CONFIDENCE, SETLIST_CATEGORIES, parseHistoryLinks, formatHistoryLinks, checkHistoryLinks, HISTORY_LINK_LABEL_MAX, parseHistoryTags, formatHistoryTags, HISTORY_TAG_MAX, splitVideo, youtubeId, HISTORY_CATEGORIES, SITE_KINDS } from "./data.js";
import { Table } from "./csv-table.js"; // 読み込んだ CSV と、まだ保存していない変更
import { h, downloadFile } from "./ui.js";
import { STORE_TOKEN, STORE_REPO, lsGet, lsSet, repoName, GhError, GitHub, saveBranch } from "./github.js";
// 保存先のブランチ（saveBranch）は github.js にある（記事の管理と同じ決まり）

const nf = (s) => String(s ?? "").normalize("NFKC").trim();
const oneLine = (s) => String(s ?? "").replace(/\s*\n\s*/g, " ").trim();

const T = {
  history: new Table({ file: "data/history.csv", what: "年表（data/history.csv）", label: "出来事", parse: parseHistory, newestFirst: false }),
  sites: new Table({ file: "data/sites.csv", what: "特設サイトの一覧（data/sites.csv）", label: "特設サイト", parse: parseSites, newestFirst: true }),
  // セトリ（RAD LIVE SET LIST のデータ）。ライブ・ツアーの出来事の「直す」から、公演を足す・直す・消す（運営の希望 11/23）
  setlists: new Table({ file: "data/setlists.csv", what: "セットリスト（data/setlists.csv）", label: "公演", parse: parseSetlists, newestFirst: false })
};
// セトリは「公演日」の1列（2017-02-25 の形）で日付の順に並べる（年表・特設サイトは「年」「月」「日」の3列）
T.setlists.dateKey = (r) => {
  const m = nf(T.setlists.cell(r, "公演日")).match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
  return m ? [m[1], (m[2] || "0").padStart(2, "0"), (m[3] || "0").padStart(2, "0")].join("-") : "0000-00-00";
};
// 新しい公演は、同じライブ名の公演のまとまりの中（日付の順）に入れる（setlists.csv は RAD 本体・山口智史・illion のまとまりごとに並んでいるので、
// ファイルの最後に入れると、同じ日の公演の「#2」の番号がずれて、「行った」の印がほかの公演に移ることがある）。同じライブ名がなければ、日付の順
T.setlists.insertSorted = (rows, cells) => {
  const t = T.setlists, k = t.dateKey(cells), name = t.cell(cells, "ライブ名");
  const same = rows.map((r, i) => [r, i]).filter(([r]) => t.cell(r, "ライブ名") === name);
  if (same.length) {
    const after = same.filter(([r]) => t.dateKey(r) <= k).pop();
    rows.splice(after ? after[1] + 1 : same[0][1], 0, cells);
    return;
  }
  const i = rows.findIndex((r) => t.dateKey(r) > k);
  rows.splice(i < 0 ? rows.length : i, 0, cells);
};
// 保存したときの記録（コミット）に出す名前
const SAVE_NAMES = { history: "年表", sites: "特設サイトの一覧", setlists: "セットリスト" };

/* ---------- 状態 ---------- */

const A = {
  root: null, opts: null,
  mode: "off",   // off：つないでいない　connecting：読み込み中　github：GitHub とつながっている　practice：保存せずに試す
  error: "", gh: null, saving: false,
  editing: null  // 編集中 { table: "history" | "sites", index: 何番目か（追加は null）, orig: もとの行の中身 }
};
const pending = () => Object.values(T).reduce((n, t) => n + t.counts().total, 0);

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
const show = () => A.opts.rebuild(T.history.text(), T.sites.text(), T.setlists.header.length ? T.setlists.text() : "");

/* ---------- GitHub ---------- */

async function connect(token, repo) {
  A.mode = "connecting"; A.error = "";
  render();
  try {
    A.gh = new GitHub(token, repo);
    await A.gh.init({ branch: saveBranch() });
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
  if (!T.setlists.header.length && src.setlists) T.setlists.load(src.setlists);
  A.mode = "practice"; A.error = "";
  show(); // 年表を、この表の中身で作り直す（「直す」の行番号を、表とそろえるため）
  render();
}
// 公開中のサイトの CSV で「保存せずに試す」に切り替える（GitHub の年表に「関連リンク」の列がまだないときに、関連リンクを試すため）
function practiceFromPage() {
  if (pending()) { toast("保存していない変更があるので切り替えられません。先に保存するか、「取り消す」を押してください"); return; }
  const src = A.opts.sourceTexts();
  if (!src.history) { toast("年表を読み込めていません。ページを読み込み直してください"); return; }
  T.history.load(src.history);
  if (src.sites) T.sites.load(src.sites);
  if (src.setlists) T.setlists.load(src.setlists);
  A.mode = "practice"; A.error = "";
  closeEditor();
  show(); render();
  toast("公開中のサイトの年表で、保存せずに試しています。出来事の「直す」から関連リンクを試せます");
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
      const key = Object.keys(T).find((k) => T[k] === t);
      const message = `${SAVE_NAMES[key]}を更新（歩みのページから：追加 ${c.add}・修正 ${c.edit}・削除 ${c.delete}）`;
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
    toast(A.gh.branch !== A.gh.defaultBranch ? `GitHub の正式版のブランチ（${A.gh.branch}）に保存しました。チェックが通ると、数分でこのプレビューに反映されます` : "GitHub に保存しました。1〜2分でサイトに反映されます");
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
    ? h("p", { class: "hadm-msg" }, h("span", { class: "dot ok", "aria-hidden": "true" }), `GitHub につながっています（${A.gh.repo}・${A.gh.branch}）。下の年表は、GitHub の最新の内容です。`,
      A.gh.branch !== A.gh.defaultBranch ? `保存すると正式版のブランチ（${A.gh.branch}）に入り、チェックが通ると数分でこのプレビューに反映されます（ベータ版のサイトには入りません）。` : "")
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
  ev.video = buildVideoBox();
  ev.box = h("div", { class: "hadm-fields" },
    h("div", { class: "admfield" }, h("span", { text: "日付（年は必須。わかる所まで）" }), ev.start),
    h("div", { class: "admfield" }, h("span", { text: "終わりの日付（ツアーなど、期間のある出来事のとき）" }), ev.end),
    field("主なカテゴリ（年表の点の色）", ev.cat),
    h("div", { class: "fgroup" }, h("h3", { text: "ほかにも当てはまるカテゴリ（そのタブにも出ます）" }), ev.more),
    field("出来事（必須）", ev.text, "作品名・ライブ名を「」か『』で囲むと、いちばん初めのものが押せるリンクになります（下の「公式ページ」か「CD を探す」があるとき）。"),
    field("補足", ev.note, "出来事の下に小さく出ます。"),
    field("特設サイト・公式ページの URL", ev.site, "https:// で始まる URL。作品名・ライブ名を押すと開きます。"),
    field("CD を探す（タワーレコードの列）", ev.tower, "検索する言葉（例：RADWIMPS 人間開花）か、tower.jp の商品ページの URL。書くと、作品名を押したときに「CD を探す」が開きます。"),
    ev.video,
    buildTagBox(ev),
    buildLinkBox(ev),
    buildSetlistBox(ev));

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
  // カテゴリや日付を変えたら、セトリの欄（ライブ・ツアーのときだけ）と、その期間の公演の一覧を出し直す
  F.form.addEventListener("change", (e) => { if (A.editing?.table === "history" && !e.target.closest(".hadm-slform")) renderSetlistBox(); });
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

/* ---------- セトリ（RAD LIVE SET LIST の公演） ---------- */
// ライブ・ツアーの出来事の「直す」に出す欄。出来事の日付（期間）に入る公演（data.js の historyShows。歩み・SET LIST と同じ決まり）を並べ、
// 公演を足す・直す・消すと、data/setlists.csv の変更として「保存していない変更」に入る（「GitHub に保存」で保存。SET LIST のページにもそのまま出る）。
// 出来事の「この内容にする」とは別に、公演の「この公演を足す／直す」を押した時点で変更に入る
const SL_FIELDS = ["公演日", "ライブ名", "会場", "区分", "本編", "アンコール", "ゲスト", "確かさ", "出典", "出典URL", "メモ"];
const isLiveForm = () => {
  const ev = F.ev;
  return ev.cat.value === "ライブ・ツアー" || [...ev.more.querySelectorAll("input:checked")].some((x) => x.value === "ライブ・ツアー");
};
function buildSetlistBox(ev) {
  ev.slList = h("ul", { class: "hadm-links", "aria-label": "この出来事の公演" });
  ev.slAdd = h("button", { type: "button", class: "btn", "data-sladd": "", text: "＋ 公演（セトリ）を追加" });
  const S = ev.sl = {};
  const text = (ph, attrs = {}) => h("input", { type: "text", autocomplete: "off", placeholder: ph, ...attrs });
  S.date = h("input", { type: "text", inputmode: "numeric", autocomplete: "off", maxlength: "10", placeholder: "例：2017-05-10（日がわからなければ 2017-05）", "aria-label": "公演日" });
  S.name = text("例：Human Bloom Tour 2017");
  S.venue = text("例：横浜アリーナ（神奈川）");
  S.cat = h("select", { "aria-label": "区分" }, ...SETLIST_CATEGORIES.map((c) => h("option", { value: c, text: c })));
  S.main = h("textarea", { rows: "8", spellcheck: "false", placeholder: "1行に1曲。演奏した順に\n例：\nNEVER EVER ENDER\n光\n前前前世" });
  S.encore = h("textarea", { rows: "3", spellcheck: "false", placeholder: "1行に1曲（なければ空欄）" });
  S.guests = text("例：あいみょん、Taka（「、」で区切る）");
  S.conf = h("select", { "aria-label": "確かさ" }, ...SETLIST_CONFIDENCE.map((c) => h("option", { value: c.name, text: c.label === c.name ? c.name : `${c.name}（${c.label}）` })));
  S.source = text("例：ORICON NEWS（ライブレポート）");
  S.url = h("input", { type: "url", inputmode: "url", autocomplete: "off", spellcheck: "false", placeholder: "https://" });
  S.note = text("運営用のメモ（サイトに出ないものもあります）");
  S.issues = h("div", { class: "editissues", "aria-live": "polite" });
  S.save = h("button", { type: "button", class: "btn primary", "data-slsave": "" });
  S.cancel = h("button", { type: "button", class: "btn plain", "data-slcancel": "", text: "やめる" });
  S.del = h("button", { type: "button", class: "btn plain danger", "data-sldel": "", text: "この公演を消す" });
  ev.slForm = h("div", { class: "hadm-slform", hidden: "" },
    h("h4", { class: "hadm-slform-title" }),
    field("公演日（必須）", S.date),
    field("ライブ名（必須）", S.name, "同じライブ名の公演が、SET LIST で1つのツアーにまとまります。"),
    field("会場", S.venue, "会場名（都道府県）の形。"),
    field("区分", S.cat),
    field("本編（1行に1曲）", S.main, "演奏した順に。【アンコール1】【kZm】などの見出しは、その行だけに書きます。「／」で区切って貼り付けてもかまいません。"),
    field("アンコール（1行に1曲）", S.encore),
    field("ゲスト", S.guests),
    field("確かさ", S.conf, "ライブレポートで確かめたら「確認済み」、ファンの投稿サイトなら「未確認」。セトリがまだなら「セトリなし」。"),
    field("出典", S.source), field("出典URL", S.url), field("メモ", S.note),
    S.issues,
    h("div", { class: "panelbtns" }, S.save, S.cancel, S.del));
  ev.slBox = h("div", { class: "fgroup hadm-linkbox" },
    h("h3", { text: "セトリ（RAD LIVE SET LIST の公演）" }),
    h("p", { class: "hadm-note", text: "この出来事の日付（期間）に入る公演です。足した・直した公演は「保存していない変更」に入り、「GitHub に保存」で SET LIST のページにも出ます。" }),
    ev.slList, ev.slAdd, ev.slForm);
  const lines = (s) => String(s || "").split(/[\n／]/).map((x) => x.trim()).filter(Boolean);
  const cellsOf = () => {
    const t = T.setlists, base = ev.slEditing?.index != null ? t.rows[ev.slEditing.index] : null;
    const map = { "公演日": nf(S.date.value), "ライブ名": oneLine(S.name.value), "会場": oneLine(S.venue.value), "区分": S.cat.value,
      "本編": lines(S.main.value).join("／"), "アンコール": lines(S.encore.value).join("／"), "ゲスト": oneLine(S.guests.value),
      "確かさ": S.conf.value, "出典": oneLine(S.source.value), "出典URL": S.url.value.trim(), "メモ": oneLine(S.note.value) };
    return t.header.map((col, i) => (col in map ? String(map[col] ?? "") : base ? base[i] ?? "" : ""));
  };
  // 書式のチェック（年表と同じく、サイトのチェックと同じ決まり）。戻り値：直す必要のある問題
  const check = () => {
    const t = T.setlists, idx = ev.slEditing?.index;
    const cells = cellsOf(), others = t.rows.filter((_, i) => i !== idx);
    const text = t.text([...others, cells]);
    const line = parseCSV(text).lines[others.length + 1];
    const res = t.parse(text);
    const errors = [...(S.date.value.trim() ? [] : ["公演日を入れてください"]), ...res.errors.filter((x) => x.line === line).map((x) => x.msg)];
    const warnings = res.warnings.filter((x) => x.line === line).map((x) => x.msg);
    S.issues.replaceChildren(...errors.map((m) => h("p", { class: "msg err", text: "直してください：" + m })), ...warnings.map((m) => h("p", { class: "msg", text: "注意：" + m })));
    S.save.disabled = errors.length > 0;
    return { errors, cells };
  };
  ev.slForm.addEventListener("input", check);
  ev.slForm.addEventListener("change", check);
  ev.slBox.addEventListener("click", (e) => {
    const t = T.setlists;
    if (e.target.closest("[data-sladd]")) {
      if (!t.header.length) { toast("セットリストを読み込めていないので、ここでは足せません。ページを読み込み直してください"); return; }
      ev.slEditing = { index: null, orig: null };
      const [y, m, d] = getDate("s");
      S.date.value = y && m ? `${y}-${String(m).padStart(2, "0")}${d ? `-${String(d).padStart(2, "0")}` : ""}` : "";
      // ライブ名と区分は、この期間に今ある公演のもの（いちばん多いもの）を使う（SET LIST で同じツアーにまとまるように）。
      // 公演がまだないときだけ、出来事の「」の中の名前
      const cur = ev.slShows || [];
      const top = (key) => { const c = new Map(); for (const l of cur) if (l[key]) c.set(l[key], (c.get(l[key]) || 0) + 1); return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] || ""; };
      S.name.value = top("name") || quotedNames(ev.text.value)[0] || ""; S.venue.value = "";
      S.cat.value = SETLIST_CATEGORIES.includes(top("cat")) ? top("cat") : SETLIST_CATEGORIES[0];
      S.main.value = ""; S.encore.value = ""; S.guests.value = ""; S.conf.value = "セトリなし"; S.source.value = ""; S.url.value = ""; S.note.value = "";
      openSlForm("公演を追加", "この公演を足す", false);
      return;
    }
    const ed = e.target.closest("[data-sledit]");
    if (ed) {
      const i = +ed.dataset.sledit, r = t.rows[i], c = (n) => t.cell(r, n);
      ev.slEditing = { index: i, orig: toCSVLine(r) };
      S.date.value = c("公演日");
      S.name.value = c("ライブ名"); S.venue.value = c("会場"); S.cat.value = SETLIST_CATEGORIES.includes(c("区分")) ? c("区分") : SETLIST_CATEGORIES[0];
      S.main.value = lines(c("本編")).join("\n"); S.encore.value = lines(c("アンコール")).join("\n"); S.guests.value = c("ゲスト");
      S.conf.value = SETLIST_CONFIDENCE.some((x) => x.name === c("確かさ")) ? c("確かさ") : "セトリなし";
      S.source.value = c("出典"); S.url.value = c("出典URL"); S.note.value = c("メモ");
      openSlForm(`公演を直す（${c("公演日")}）`, "この公演を直す", true);
      return;
    }
    if (e.target.closest("[data-slcancel]")) { closeSlForm(); return; }
    if (e.target.closest("[data-slsave]")) {
      const { errors, cells } = check();
      if (errors.length) return;
      const isNew = ev.slEditing.index == null;
      if (!t.doOp({ type: isNew ? "add" : "edit", orig: ev.slEditing.orig, cells })) { closeSlForm(); toast("変わったところがないので、そのままにしました"); return; }
      closeSlForm();
      show(); render();
      // この一覧に出たかを、行で確かめる（出ないとき：期間の外か、期間の中のいちばん多いライブ名とちがうライブ名）
      const row = t.rows.findIndex((r) => toCSVLine(r) === toCSVLine(cells));
      const listed = !!ev.slList.querySelector(`[data-sledit="${row}"]`);
      toast(`公演を${isNew ? "足し" : "直し"}ました（まだ保存していません。年表の上の「GitHub に保存」で保存します）`
        + (listed ? "" : "。日付がこの出来事の期間の外か、ライブ名がこの期間のほかの公演とちがうので、この一覧には出ませんが、SET LIST には出ます"));
      return;
    }
    if (e.target.closest("[data-sldel]")) {
      if (!confirmInline(S.del, "もう一度押すと、この公演を消します")) return;
      t.doOp({ type: "delete", orig: ev.slEditing.orig, cells: null });
      closeSlForm();
      show(); render();
      toast("公演を消しました（まだ保存していません）");
    }
  });
  function openSlForm(title, saveText, canDelete) {
    ev.slForm.querySelector(".hadm-slform-title").textContent = title;
    S.save.textContent = saveText;
    S.del.hidden = !canDelete;
    ev.slForm.hidden = false; ev.slAdd.hidden = true;
    check();
    S.date.focus();
  }
  function closeSlForm() {
    ev.slForm.hidden = true; ev.slAdd.hidden = false; ev.slEditing = null;
    renderSetlistBox();
    ev.slAdd.focus();
  }
  return ev.slBox;
}
// セトリの欄を出し直す：ライブ・ツアーのときだけ出し、出来事の日付（期間）に入る公演を並べる
function renderSetlistBox() {
  const ev = F.ev;
  if (!ev.slBox) return;
  const show = isLiveForm();
  ev.slBox.hidden = !show;
  if (!show) return;
  const t = T.setlists;
  if (!t.header.length) { ev.slList.replaceChildren(h("li", { class: "hadm-empty", text: "セットリストを読み込めていません。" })); return; }
  const [y, m, d] = getDate("s"), [ey, em, ed] = getDate("e");
  const pseudo = { y: +y || 0, m: +m || 0, d: +d || 0, ey: +ey || 0, em: +em || 0, ed: +ed || 0, cats: [{ name: "ライブ・ツアー" }] };
  // 表の行（何番目か）と、読み取った公演を対応させる（同じ CSV から作るので、行番号でつなぐ）
  const text = t.text(), { lines } = parseCSV(text);
  const lives = parseSetlists(text).lives;
  const shows = historyShows(pseudo, lives);
  ev.slShows = shows;
  const idxOf = (l) => lines.indexOf(l.line) - 1;
  ev.slList.replaceChildren(...(shows.length ? shows.map((l) => {
    const n = (l.main?.length || 0) + (l.encore?.length || 0);
    return h("li", {}, h("span", { text: `${l.date} ${l.venue || ""}（${n ? `${n}曲` : "曲なし"}・${l.conf?.name || ""}）` }),
      h("button", { type: "button", class: "btn", "data-sledit": String(idxOf(l)), "aria-label": `${l.date} ${l.venue || ""}の公演を直す`, text: "直す" }));
  }) : [h("li", { class: "hadm-empty", text: m ? "この期間の公演は、まだありません。" : "日付（月まで）を入れると、その期間の公演が出ます。" })]));
}

/* ---------- タグ（検索のための言葉） ---------- */
// 出来事に付ける言葉。年表には出さず、歩みの検索窓で見つかるようになる（例：ライブの愛称、作品の別の呼び方）
function buildTagBox(ev) {
  ev.tags = [];
  ev.tagList = h("ul", { class: "hadm-tags", "aria-label": "付けているタグ" });
  ev.tagIn = h("input", { type: "text", autocomplete: "off", maxlength: String(HISTORY_TAG_MAX), enterkeyhint: "done", list: "hadmTagList", placeholder: "例：胎盤ツアー", "aria-label": "足すタグ" });
  ev.tagSuggest = h("datalist", { id: "hadmTagList" });
  const add = h("button", { type: "button", class: "btn", "data-tadd": "", text: "足す" });
  const tryBtn = h("button", { type: "button", class: "btn", text: "公開中のサイトの年表で、保存せずに試す" });
  tryBtn.addEventListener("click", practiceFromPage);
  ev.tagMissing = h("div", { class: "hadm-linkmissing", hidden: "" },
    h("p", { class: "msg", text: "いま読み込んでいる年表には「タグ」の列がまだないので、タグは付けられません。試すときは、下のボタンで「保存せずに試す」に切り替えてください（GitHub には保存されません）。" }),
    tryBtn);
  ev.tagControls = h("div", { class: "hadm-linkbox" },
    ev.tagList,
    h("div", { class: "admfield" }, h("span", { text: "タグを足す" }),
      h("div", { class: "hadm-urlrow" }, ev.tagIn, add),
      h("small", { text: `年表には出ません。歩みの検索窓で、この言葉でも見つかるようになります（例：ライブの愛称、作品の別の呼び方）。1つ ${HISTORY_TAG_MAX} 文字まで。Enter でも足せます。` })),
    ev.tagSuggest);
  const box = h("div", { class: "fgroup hadm-linkbox" }, h("h3", { text: "タグ（検索のための言葉）" }), ev.tagMissing, ev.tagControls);
  const addTag = () => {
    const t = ev.tagIn.value.replace(/[#＃]/g, " ").replace(/\s+/g, " ").trim();
    if (!t) { toast("足すタグを書いてください"); ev.tagIn.focus(); return; }
    // 全角・半角のちがいだけのタグ（「ＡＢＣ」と「ABC」）も、同じものとして扱う
    if (ev.tags.some((x) => nf(x).toLowerCase() === nf(t).toLowerCase())) { toast(`「${t}」は、もう付いています`); ev.tagIn.select(); return; }
    ev.tags.push(t);
    ev.tagIn.value = "";
    renderTags(); validate();
    ev.tagIn.focus();
    toast(`タグ「${t}」を足しました（まだ保存していません。下の「この内容にする」を押すと年表に映ります）`);
  };
  ev.tagIn.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); addTag(); } });
  box.addEventListener("click", (e) => {
    if (e.target.closest("[data-tadd]")) return addTag();
    const rm = e.target.closest("[data-trm]");
    if (!rm) return;
    const i = +rm.dataset.trm, t = ev.tags[i];
    ev.tags.splice(i, 1);
    renderTags(); validate();
    (ev.tagList.querySelectorAll("[data-trm]")[Math.min(i, ev.tags.length - 1)] || ev.tagIn).focus();
    toast(`タグ「${t}」を外しました（まだ保存していません）`);
  });
  ev.tagBox = box;
  return box;
}
function renderTags() {
  const ev = F.ev;
  ev.tagList.replaceChildren(...(ev.tags.length ? ev.tags.map((t, i) => h("li", {},
    h("span", { text: `#${t}` }),
    h("button", { type: "button", class: "hadm-tag-x", "data-trm": String(i), "aria-label": `タグ「${t}」を外す`, text: "✕" })))
    : [h("li", { class: "hadm-empty", text: "まだ付けていません。" })]));
}
// 入力の候補：ほかの出来事で使っているタグ（表記をそろえやすくするため）
function tagSuggestions() {
  const t = T.history, set = new Set();
  for (const r of t.rows) for (const x of parseHistoryTags(t.cell(r, "タグ")).tags) set.add(x);
  F.ev.tagSuggest.replaceChildren(...[...set].sort((a, b) => a.localeCompare(b, "ja")).map((x) => h("option", { value: x })));
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
// ---------- 動画の欄 ----------
// 1本ずつ「種類」「曲名・題」「YouTube の URL」を入れる。保存するときに、CSV の「動画」の列の形（ラベル=URL を「 | 」で区切る）にする。
//   種類が MV・ライブ映像・スタジオライブ・リリックビデオ・予告編なら、ラベルは「種類」か「種類「曲名」」（例：ライブ映像「トアルハルノヒ」）。
//   「その他」は、曲名・題の欄に書いた文字がそのままラベルになる（ほかのアーティストの演奏など。例：BUMP OF CHICKEN「embrace」）。
// ラベルが「MV」で始まると歩みの MV のタブに、MV・リリックビデオ・ライブ映像・スタジオライブは楽曲一覧の「MV・ライブ映像」にも使われる（RADWIMPS の曲として）。
const VIDEO_KINDS = ["MV", "ライブ映像", "スタジオライブ", "リリックビデオ", "予告編"];
const VIDEO_OTHER = "その他";
function buildVideoBox() {
  const list = h("ul", { class: "hadm-videos", "aria-label": "動画の一覧" });
  const add = h("button", { type: "button", class: "btn", "data-vadd": "", text: "動画を足す" });
  const box = h("div", { class: "fgroup hadm-videobox" },
    h("h3", { text: "動画（出来事の下に「▶ 種類」で並びます）" }),
    h("p", { class: "hadm-note", text: "種類を選び、YouTube の URL を貼ります。曲名・題は空でもかまいません。「MV」は歩みの MV のタブにも並び、MV・ライブ映像・スタジオライブ・リリックビデオは楽曲一覧でもその曲の動画として使います。ほかのアーティストの演奏などは「その他」を選び、曲名・題の欄に出したい文字（例：BUMP OF CHICKEN「embrace」）を書いてください。「その他」でも、文字が「MV」で始まるもの（例：MV（StayHome ver.））は MV として扱います。" }),
    list, add);
  box.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-vrm]");
    if (e.target.closest("[data-vadd]")) {
      const row = videoRow({ kind: "MV", title: "", url: "" });
      list.append(row); renumberVideos(); row.querySelector("select").focus(); validate();
    } else if (rm) {
      const li = rm.closest("li"), next = li.nextElementSibling || li.previousElementSibling;
      li.remove();
      renumberVideos();
      (next ? next.querySelector("select") : add).focus();
      validate();
      toast("動画を外しました（まだ保存していません。下の「この内容にする」を押すと年表に映ります）");
    }
  });
  box.addEventListener("change", (e) => { if (e.target.matches("select[data-vkind]")) videoHint(e.target.closest("li")); });
  box.list = list;
  return box;
}
// 読み上げ用の名前の番号は、上から数えた番号（チェックの「○本目」と合わせる）。足す・外すたびに付け直す
function renumberVideos() {
  [...F.ev.video.list.children].forEach((li, i) => {
    const n = i + 1;
    li.querySelector("[data-vkind]").setAttribute("aria-label", `動画${n}本目の種類`);
    li.querySelector("[data-vtitle]").setAttribute("aria-label", `動画${n}本目の曲名・題`);
    li.querySelector("[data-vurl]").setAttribute("aria-label", `動画${n}本目の YouTube の URL`);
    li.querySelector("[data-vrm]").setAttribute("aria-label", `動画${n}本目を外す`);
  });
}
function videoRow(v) {
  const kind = h("select", { "data-vkind": "" }, ...[...VIDEO_KINDS, VIDEO_OTHER].map((k) => opt(k)));
  kind.value = v.kind;
  const title = h("input", { type: "text", autocomplete: "off", "data-vtitle": "", value: v.title });
  const url = h("input", { type: "url", inputmode: "url", autocomplete: "off", spellcheck: "false", "data-vurl": "", value: v.url, placeholder: "https://www.youtube.com/watch?v=…" });
  const li = h("li", {}, h("div", { class: "hadm-videorow" }, kind, title, url,
    h("button", { type: "button", class: "btn", "data-vrm": "", text: "✕" })));
  videoHint(li);
  return li;
}
// 「その他」のときは、曲名・題の欄が、そのまま出来事の下に出る文字になる
function videoHint(li) {
  const other = li.querySelector("[data-vkind]").value === VIDEO_OTHER;
  li.querySelector("[data-vtitle]").placeholder = other ? "出す文字（必須。例：BUMP OF CHICKEN「embrace」）" : "曲名（例：トアルハルノヒ。空でも可）";
}
function setVideos(text) {
  const rows = String(text || "").split("|").map((x) => x.trim()).filter(Boolean).map((part) => {
    const m = splitVideo(part);
    if (!m) return { kind: VIDEO_OTHER, title: "", url: part }; // 読めないものは URL の欄に入れて、チェックで知らせる
    const label = (m[1] || "").trim(), url = m[2];
    if (!label) return { kind: "MV", title: "", url }; // ラベルがないものは、これまでどおり MV として読む
    const k = label.match(/^(MV|ライブ映像|スタジオライブ|リリックビデオ|予告編)\s*(?:「(.*)」)?$/);
    return k ? { kind: k[1], title: k[2] || "", url } : { kind: VIDEO_OTHER, title: label, url };
  });
  F.ev.video.list.replaceChildren(...rows.map(videoRow));
  renumberVideos();
}
// 曲名・題に、CSV の区切りに使う「|」「=」があると読めなくなるので、空白に変える。「」は種類のあとに付けるので外す
function videosText() {
  return [...F.ev.video.list.children].map((li) => {
    const kind = li.querySelector("[data-vkind]").value;
    const title = oneLine(li.querySelector("[data-vtitle]").value).replace(/[|=]/g, " ").replace(/\s+/g, " ").trim();
    const url = li.querySelector("[data-vurl]").value.trim().replace(/\|/g, "");
    if (!url) return ""; // URL のない行は保存しない（チェックで「URL を貼ってください」と知らせる）
    const label = kind === VIDEO_OTHER ? title : title ? `${kind}「${title.replace(/^「(.*)」$/, "$1")}」` : kind;
    return label ? `${label}=${url}` : url;
  }).filter(Boolean).join(" | ");
}

function buildLinkBox(ev) {
  ev.links = [];
  ev.linkList = h("ul", { class: "hadm-links", "aria-label": "つないでいるリンク" });
  ev.artQ = h("input", { type: "search", autocomplete: "off", enterkeyhint: "search", placeholder: "例：人間開花 ナタリー" });
  ev.artHits = h("ul", { class: "hadm-hits", "aria-label": "見つかった記事", "aria-live": "polite" });
  ev.urlLabel = h("input", { type: "text", autocomplete: "off", maxlength: String(HISTORY_LINK_LABEL_MAX), placeholder: "例：公式ニュース", "aria-label": "リンクのラベル（出来事の下に出る文字）" });
  ev.urlUrl = h("input", { type: "url", inputmode: "url", autocomplete: "off", spellcheck: "false", placeholder: "https://", "aria-label": "リンクの URL" });
  const add = h("button", { type: "button", class: "btn", "data-lurl": "", text: "足す" });
  // 保存先の年表に「関連リンク」の列がないとき（正式版を main に入れる前）の説明と、試すためのボタン
  const tryBtn = h("button", { type: "button", class: "btn", "data-ltry": "", text: "公開中のサイトの年表で、保存せずに試す" });
  ev.linkMissing = h("div", { class: "hadm-linkmissing", hidden: "" },
    h("p", { class: "msg", text: "いま読み込んでいる年表（GitHub の main から読んだもの）には、「関連リンク」の列がまだありません。正式版を main に入れると、ここで記事などをつないで保存できるようになります。" }),
    h("p", { class: "msg", text: "いま試すときは、下のボタンで「保存せずに試す」に切り替えてください（GitHub には保存されません）。" }),
    tryBtn);
  ev.linkControls = h("div", { class: "hadm-linkbox" });
  const box = h("div", { class: "fgroup hadm-linkbox" },
    h("h3", { text: "関連リンク（記事など。出来事の下に並びます）" }),
    ev.linkMissing, ev.linkControls);
  ev.linkControls.append(
    ev.linkList,
    field("記事一覧の記事から選ぶ", ev.artQ, "タイトル・媒体・人の名前・日付（例：2016）で探せます。空白で区切ると、すべての言葉に合う記事だけ。「つなぐ」で足します。"),
    ev.artHits,
    h("div", { class: "admfield" }, h("span", { text: "ほかのページの URL を足す" }),
      h("div", { class: "hadm-urlrow" }, ev.urlLabel, ev.urlUrl, add),
      h("small", { text: `ラベルは出来事の下に出る文字です（例：公式ニュース、ライブレポート。${HISTORY_LINK_LABEL_MAX}文字まで）。https:// で始まる URL だけ使えます。` })));
  tryBtn.addEventListener("click", practiceFromPage);
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
    setVideos(c("動画"));
    // 長すぎるタグ（CSV を手で直したときなど）も消さずに残す（エラーが出て「この内容にする」が押せないので、気づいて直せる）
    { const tg = parseHistoryTags(c("タグ")); ev.tags = [...tg.tags, ...tg.bad]; }
    ev.tagIn.value = "";
    renderTags(); tagSuggestions();
    const hasTagCol = t.header.includes("タグ");
    ev.tagControls.hidden = !hasTagCol;
    ev.tagMissing.hidden = hasTagCol;
    const lk = parseHistoryLinks(c("関連リンク"));
    ev.links = [...lk.links, ...lk.bad.map((text) => ({ type: "raw", text }))];
    ev.artQ.value = ""; ev.urlLabel.value = ""; ev.urlUrl.value = "";
    renderLinks(); renderHits();
    // 古い年表の CSV（「関連リンク」の列がない）では、足しても保存されないので、操作の欄の代わりに理由と「試す」ボタンを出す
    ev.slForm.hidden = true; ev.slEditing = null; ev.slAdd.hidden = false;
    renderSetlistBox();
    const hasCol = t.header.includes("関連リンク");
    ev.linkControls.hidden = !hasCol;
    ev.linkMissing.hidden = hasCol;
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
  // 公演の入力の途中で閉じたときは、足していないことを知らせる（入力中の公演は、変更には入っていない）
  if (F.ev?.slForm && !F.ev.slForm.hidden && A.editing?.table === "history") toast("入力中だった公演は、足していません（「この公演を足す／直す」を押すまでは変更に入りません）");
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
      "動画": videosText(), "関連リンク": formatHistoryLinks(ev.links), "タグ": formatHistoryTags(ev.tags) };
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
    // 動画の書き方のエラーは、下で「○本目」と分かる文に出し直すので、CSV の書き方の文は外す
    for (let k = errors.length - 1; k >= 0; k--) if (/^動画「/.test(errors[k])) errors.splice(k, 1);
    const seenVid = new Map();
    [...F.ev.video.list.children].forEach((li, i) => {
      const other = li.querySelector("[data-vkind]").value === VIDEO_OTHER;
      const title = li.querySelector("[data-vtitle]").value.trim(), url = li.querySelector("[data-vurl]").value.trim();
      if (!title && !url) return; // 空の行は保存しない
      if (!url) errors.push(`動画の ${i + 1} 本目に、YouTube の URL を貼ってください（要らない行は ✕ で外せます）`);
      else if (!youtubeId(url, { allowId: true })) errors.push(`動画の ${i + 1} 本目の URL を、YouTube の動画として読めません（https://www.youtube.com/watch?v=… か https://youtu.be/… を貼ってください）`);
      else { const id = youtubeId(url, { allowId: true }); if (seenVid.has(id)) warnings.push(`動画の ${i + 1} 本目は、${seenVid.get(id)} 本目と同じ動画です`); else seenVid.set(id, i + 1); }
      if (/[|=]/.test(title)) warnings.push(`動画の ${i + 1} 本目の曲名・題にある「|」「=」は、保存するときに空白に置き換えます`);
      if (other && !title) errors.push(`動画の ${i + 1} 本目は「その他」なので、曲名・題の欄に、出来事の下に出す文字を書いてください`);
    });
    if (F.ev.tagIn.value.trim()) errors.push("「タグを足す」に書いた言葉が、まだ足されていません。「足す」を押すか、欄を空にしてください");
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
