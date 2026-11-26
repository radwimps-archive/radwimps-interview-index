// assets/admin-songs.js
// 「楽曲一覧」のページの「楽曲の管理」です。管理者モードの端末で、楽曲一覧を開いたときだけ読み込まれます（songs.js）。
// 作りと決まりは、歩みの「年表の管理」（admin-history.js）と同じです。
//   ・曲（data/songs.csv）を、追加（「＋ 曲を追加」）・修正（曲の下の「直す」）・削除できます。
//   ・直した内容は、すぐ下の一覧に反映されます（まだ GitHub には保存していない状態）。
//   ・「GitHub に保存」を押すと、GitHub の CSV が書き換わります（保存先のブランチは github.js の saveBranch。プレビューでは正式版のブランチ）。
//   ・合鍵（アクセストークン）は、記事一覧の運営管理（記事の管理）で登録したものを、そのまま使います。
//   ・合鍵がなくても「保存せずに試す」で試せます（直した CSV はファイルに書き出せます）。

import { parseCSV, toCSVLine, parseSongs, SONG_KINDS, SONG_ARTISTS, SONG_NOTE_MAX, LYRIC_HOSTS } from "./data.js";
import { Table } from "./csv-table.js"; // 読み込んだ CSV と、まだ保存していない変更
import { h, downloadFile } from "./ui.js";
import { STORE_TOKEN, STORE_REPO, lsGet, lsSet, repoName, GhError, GitHub, saveBranch } from "./github.js";

const nf = (s) => String(s ?? "").normalize("NFKC").trim();
const oneLine = (s) => String(s ?? "").replace(/\s*\n\s*/g, " ").trim();

// 曲は「年」「月」「日」の順に並んでいる（同じ日の曲は、作品の曲順のまま）。新しい曲は、同じ日付の曲の最後に入る
const T = new Table({ file: "data/songs.csv", what: "楽曲一覧（data/songs.csv）", label: "曲", parse: parseSongs, newestFirst: false });
// songs.csv は日付の順に一本で並んでいない（おもな曲のあとに、カップリング・サウンドトラック、最後に illion の曲がまとまっている）。
// 一覧は「日付が同じなら CSV の順」で並べるので、新しい曲（日付を直した曲）は次の順で場所を決める：
//   1. 同じ名義・同じ日付・同じ「初めて出た作品」の行があれば、そのいちばん最後のうしろ（作品の曲順の最後）
//   2. なければ、同じ名義の行の中で、日付が自分以前のいちばん最後の行のうしろ（なければ、同じ名義の最初の行の前）
//   3. 同じ名義の行がなければ、ファイルの最後
const artistKey = (r) => { const a = nf(T.cell(r, "名義")).toLowerCase(); return a === "radwimps" ? "" : a; };
T.insertSorted = (rows, cells) => {
  const k = T.dateKey(cells), a = artistKey(cells), w = nf(T.cell(cells, "初めて出た作品"));
  const idx = rows.map((r, i) => [r, i]).filter(([r]) => artistKey(r) === a);
  const sameWork = idx.filter(([r]) => T.dateKey(r) === k && nf(T.cell(r, "初めて出た作品")) === w).pop();
  if (sameWork) { rows.splice(sameWork[1] + 1, 0, cells); return; }
  if (!idx.length) { rows.push(cells); return; }
  const before = idx.filter(([r]) => T.dateKey(r) <= k).pop();
  rows.splice(before ? before[1] + 1 : idx[0][1], 0, cells);
};

/* ---------- 状態 ---------- */

const A = {
  root: null, opts: null,
  mode: "off",   // off：つないでいない　connecting：読み込み中　github：GitHub とつながっている　practice：保存せずに試す
  error: "", gh: null, saving: false,
  editing: null, // 編集中 { index: 何番目か（追加は null）, orig: もとの行の中身 }
  returnTo: null
};
const pending = () => T.counts().total;

let toastBox = null, toastTimer = 0;
function toast(msg) {
  if (!toastBox) { toastBox = h("div", { class: "toast", role: "status", "aria-live": "polite" }); document.body.append(toastBox); }
  toastBox.textContent = msg;
  toastBox.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastBox.classList.remove("show"), 3200);
}
// 確認ダイアログの代わり：1回目は知らせるだけで、3秒以内にもう一度押したら実行する（年表の管理・記事の管理と同じ）
function confirmInline(btn, msg) {
  if (btn.dataset.armed === "1") return true;
  btn.dataset.armed = "1";
  toast(msg);
  setTimeout(() => { btn.dataset.armed = ""; }, 3000);
  return false;
}
function reloadNote(lost, gone) {
  return (lost ? `曲のうち ${lost} 件は、別の場所（GitHub など）で同じ行が先に直されていました。こちらで直した内容は新しい行として残してあるので、見比べて、いらないほうを消してください。` : "")
    + (gone ? `消すはずだった曲 ${gone} 件は、もう消えていたか、別の場所で直されていました（消す変更は取りやめました）。` : "");
}
// 直した内容を、ページの一覧に映す
const show = () => A.opts.rebuild(T.text());

/* ---------- GitHub ---------- */

async function connect(token, repo) {
  A.mode = "connecting"; A.error = "";
  render();
  try {
    A.gh = new GitHub(token, repo);
    await A.gh.init({ branch: saveBranch() });
    const { text, sha } = await A.gh.read(T.file, T.what);
    const { lost, gone } = T.ops.length ? T.reload(text) : (T.load(text), { lost: 0, gone: 0 });
    T.sha = sha;
    if (lost || gone) toast(reloadNote(lost, gone) + "一覧で確かめてから保存してください");
    A.mode = "github";
    show(); // GitHub の最新の内容で一覧を表示する
  } catch (e) {
    A.mode = "off";
    A.error = e instanceof GhError ? e.message : "読み込めませんでした。";
    if (e.keyProblem) lsSet(STORE_TOKEN, ""); // 使えない合鍵は、次に開いたときに使わない
  }
  render();
}
function startPractice() {
  // GitHub から読み込んだあとは、その内容と変更をそのまま使う。まだなら、ページを開いたときに読んだ CSV から始める
  const src = A.opts.sourceText();
  if (!T.header.length && !src) { toast("楽曲一覧を読み込めていません。ページを読み込み直してください"); return; }
  if (!T.header.length) T.load(src);
  A.mode = "practice"; A.error = "";
  show(); render();
}
async function save() {
  if (A.saving || A.mode !== "github" || !pending()) return;
  const errs = T.errors();
  if (errs.length) { toast(`曲に、直す必要がある問題が ${errs.length} 件あります（${errs[0].line} 行目：${errs[0].msg}）`); return; }
  A.saving = true;
  render();
  try {
    const c = T.counts();
    const message = `楽曲一覧を更新（楽曲一覧のページから：追加 ${c.add}・修正 ${c.edit}・削除 ${c.delete}）`;
    let res = await A.gh.write(T.file, T.text(), T.sha, message);
    if (res.status === 409 || res.status === 422) {
      // 開いているあいだに GitHub 側で変わっていた：最新を読み込み、今回の変更を重ねてからもう一度保存する
      const { text, sha } = await A.gh.read(T.file, T.what);
      const { lost, gone } = T.reload(text); T.sha = sha;
      if (lost || gone) throw new GhError(reloadNote(lost, gone) + "一覧で確かめてから、もう一度保存してください");
      res = await A.gh.write(T.file, T.text(), T.sha, message);
    }
    if (!res.ok) throw await A.gh.fail(res, T.what);
    T.sha = (await res.json()).content.sha;
    T.base = T.rows.map((r) => r.slice());
    T.ops = [];
    toast(A.gh.branch !== A.gh.defaultBranch ? `GitHub の正式版のブランチ（${A.gh.branch}）に保存しました。チェックが通ると、数分でこのプレビューに反映されます` : "GitHub に保存しました。1〜2分でサイトに反映されます");
  } catch (e) {
    if (e.keyProblem) {
      lsSet(STORE_TOKEN, "");
      A.mode = "off";
      A.error = e.message + "（保存していない変更は、「ファイルに書き出す」で残せます）";
    }
    toast(e instanceof GhError ? e.message : "保存できませんでした。もう一度試してください");
  }
  A.saving = false;
  show(); render();
}
function exportCsv() {
  downloadFile("songs.csv", T.text(), "text/csv");
  toast("直した CSV を書き出しました。GitHub の data フォルダに上書きでアップロードすると反映されます");
}

/* ---------- 「楽曲の管理」の欄 ---------- */

export function mountSongsAdmin(root, opts) {
  A.root = root; A.opts = opts;
  root.hidden = false;
  buildSheet();
  addEventListener("beforeunload", (e) => { if (pending()) { e.preventDefault(); e.returnValue = ""; } });
  const token = lsGet(STORE_TOKEN), repo = repoName(lsGet(STORE_REPO)) || repoName(opts.repo || "");
  if (token && repo) connect(token, repo); else render();
  return {
    // 曲の下の「直す」：line は data/songs.csv の行番号
    editSong(line) { if (ready()) openEditor(T.indexOfLine(line)); }
  };
}
function ready() {
  if (A.mode === "github" || A.mode === "practice") return true;
  toast(A.mode === "connecting" ? "読み込んでいます。少し待ってから押してください" : "先に「保存せずに試す」を押すか、合鍵を登録してください");
  A.root.scrollIntoView({ block: "start", behavior: "smooth" });
  return false;
}

function render() {
  const put = (...kids) => A.root.replaceChildren(h("div", { class: "hadm-card" }, ...kids)); // 白いカードにのせる（年表の管理と同じ）
  const head = h("div", { class: "hadm-head" },
    h("h2", { id: "songAdminTitle", text: "楽曲の管理" }),
    h("p", { class: "hadm-note", text: "管理者モードのこの端末だけに出ています。" }));
  if (A.mode === "connecting") return put(head, h("p", { class: "hadm-msg", text: "GitHub から楽曲一覧を読み込んでいます…" }));
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
    return put(...kids);
  }
  const status = A.mode === "github"
    ? h("p", { class: "hadm-msg" }, h("span", { class: "dot ok", "aria-hidden": "true" }), `GitHub につながっています（${A.gh.repo}・${A.gh.branch}）。下の一覧は、GitHub の最新の内容です。`,
      A.gh.branch !== A.gh.defaultBranch ? `保存すると正式版のブランチ（${A.gh.branch}）に入り、チェックが通ると数分でこのプレビューに反映されます（ベータ版のサイトには入りません）。` : "")
    : h("p", { class: "hadm-msg" }, h("span", { class: "dot", "aria-hidden": "true" }), "保存せずに試しています（変更は GitHub に保存されません）。");
  const add = h("button", { type: "button", class: "btn primary", "data-songadd": "", text: "＋ 曲を追加" });
  add.addEventListener("click", () => openEditor(null));
  put(head, status,
    h("div", { class: "panelbtns" }, add),
    h("p", { class: "hadm-note", text: "曲を直すときは、一覧の曲の下の「直す」を押します（作品の曲の一覧を閉じているときは、作品の「○ 曲」を押して開いてください）。" }),
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
  const c = T.counts();
  const undo = h("button", { type: "button", class: "btn plain", text: "取り消す" });
  undo.addEventListener("click", () => {
    if (!confirmInline(undo, "もう一度押すと、保存していない変更をすべて取り消します")) return;
    T.reset();
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
    h("p", null, h("b", { text: `保存していない変更 ${n} 件` }), h("span", { text: `（曲：追加 ${c.add}・修正 ${c.edit}・削除 ${c.delete}）` })),
    h("div", { class: "panelbtns" }, ...btns));
}

/* ---------- 編集の画面（下から出る小窓。年表の管理・記事の管理と同じ形） ---------- */

const F = {};
let sheet = null;
const opt = (v, t = v) => h("option", { value: v, text: t });
const field = (label, control, hint) => h("label", { class: "admfield" }, label, control, hint ? h("small", { text: hint }) : null);
const lyricHosts = LYRIC_HOSTS.filter((x) => !x.startsWith("www."));

function buildSheet() {
  F.title = h("h2", { id: "sadmTitle", text: "" });
  F.form = h("form", { class: "fgroups editform", novalidate: "" });
  F.foot = h("div", { class: "sheet-foot" });
  const close = h("button", { type: "button", class: "btn plain", "data-act": "cancel", text: "閉じる" });
  sheet = h("div", { class: "sheet hadm-sheet", hidden: "" },
    h("div", { class: "sheet-back", "data-act": "cancel" }),
    h("div", { class: "sheet-in", role: "dialog", "aria-modal": "true", "aria-labelledby": "sadmTitle" },
      h("div", { class: "sheet-head" }, F.title, close), F.form, F.foot));
  document.body.append(sheet);

  F.name = h("input", { type: "text", autocomplete: "off", placeholder: "例：前前前世" });
  F.yomi = h("input", { type: "text", autocomplete: "off", placeholder: "例：ぜんぜんぜんせ" });
  F.artist = h("select", { "aria-label": "名義" }, ...SONG_ARTISTS.map((a) => opt(a)));
  F.kind = h("select", { "aria-label": "種類" }, ...SONG_KINDS.map((k) => opt(k, k === "配信" ? "配信（配信シングル）" : k)));
  F.y = h("input", { type: "text", inputmode: "numeric", maxlength: "4", autocomplete: "off", placeholder: "2026", "aria-label": "発売日の年" });
  F.m = h("select", { "aria-label": "発売日の月" }, opt("", "—"), ...Array.from({ length: 12 }, (_, i) => opt(String(i + 1))));
  F.d = h("select", { "aria-label": "発売日の日" }, opt("", "—"), ...Array.from({ length: 31 }, (_, i) => opt(String(i + 1))));
  F.work = h("input", { type: "text", autocomplete: "off", placeholder: "例：君の名は。" });
  F.album = h("input", { type: "text", autocomplete: "off", placeholder: "例：ANTI ANTI GENERATION" });
  F.tieup = h("input", { type: "text", autocomplete: "off", placeholder: "例：映画『君の名は。』主題歌" });
  F.lyrics = h("input", { type: "url", inputmode: "url", autocomplete: "off", spellcheck: "false", placeholder: "https://petitlyrics.com/lyrics/…" });
  F.note = h("input", { type: "text", autocomplete: "off", maxlength: String(SONG_NOTE_MAX), placeholder: "例：インスト（歌のない曲）" });
  F.form.append(h("div", { class: "hadm-fields" },
    field("曲名（必須）", F.name, "同じ曲名の曲がほかの作品にもあるとき（シングルのカップリングがアルバムにも入るなど）は、同じ書き方にそろえます。"),
    field("読み（ひらがな）", F.yomi, "50音順の並びに使います。英語や数字で始まる曲は空でかまいません（「英数字」にまとまります）。"),
    field("名義", F.artist, "RADWIMPS 以外の名義（illion）の曲は、SET LIST のランキングなどには入りません。"),
    field("種類", F.kind, "初めて出た作品の種類です。配信だけの曲は「配信」（一覧では「配信シングル」と出ます）。"),
    h("div", { class: "admfield" }, h("span", { text: "発売日（年は必須。わかる所まで）" }),
      h("div", { class: "datein" }, F.y, h("span", { text: "年" }), F.m, h("span", { text: "月" }), F.d, h("span", { text: "日" }))),
    field("初めて出た作品", F.work, "アルバム名・シングル名。同じ作品の曲は、発売順の一覧で1つにまとまるので、同じ書き方にそろえます。"),
    field("アルバム（あとで入ったアルバム）", F.album, "配信やシングルの曲が、あとでアルバムに入ったときのアルバム名。"),
    field("タイアップ", F.tieup, "曲名の下に出ます。"),
    field("歌詞URL", F.lyrics, `歌詞の掲載を許諾されている歌詞サイトの、曲のページ（${lyricHosts.join("・")}）。空なら、プチリリの中を曲名で探すリンクになります。`),
    field("メモ", F.note, `画面には出ません（「メジャーデビュー」で始まるものだけ曲名の下に出ます）。「インスト」「スキット」「歌詞非公開」で始めると「歌詞」のボタンを出しません。${SONG_NOTE_MAX}文字まで。歌詞の本文は書けません。`)));

  F.issues = h("div", { class: "editissues", "aria-live": "polite" });
  F.form.append(F.issues);
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
    else if (act === "back") renderFoot();
  });
  // Esc で閉じる（日本語の変換中の Esc では閉じない）
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden && !e.isComposing && e.keyCode !== 229) closeEditor(); });
}

function openEditor(index) {
  if (index !== null && index < 0) { toast("この曲が見つかりませんでした。ページを読み込み直してください"); return; }
  if (!T.header.length) { toast("楽曲一覧を読み込めていないので、ここでは直せません。ページを読み込み直してください"); return; }
  // 閉じたあとに戻る場所（押したボタン。一覧を作り直してもボタンを探し直せるよう、目印で覚える）
  const from = document.activeElement;
  A.returnTo = from && from.matches && from.matches("[data-songedit]") ? `[data-songedit="${from.dataset.songedit}"]` : "[data-songadd]";
  const r = index === null ? null : T.rows[index];
  A.editing = { index, orig: r ? toCSVLine(r) : null };
  const c = (n) => (r ? T.cell(r, n) : "");
  F.name.value = c("曲名"); F.yomi.value = c("読み");
  const artist = nf(c("名義"));
  F.artist.value = SONG_ARTISTS.find((a) => a.toLowerCase() === artist.toLowerCase()) || SONG_ARTISTS[0];
  F.kind.value = SONG_KINDS.includes(nf(c("種類"))) ? nf(c("種類")) : SONG_KINDS[0];
  F.y.value = r ? nf(c("年")) : String(new Date().getFullYear());
  F.m.value = nf(c("月")) ? String(+nf(c("月"))) : ""; F.d.value = nf(c("日")) ? String(+nf(c("日"))) : "";
  F.work.value = c("初めて出た作品"); F.album.value = c("アルバム"); F.tieup.value = c("タイアップ"); F.lyrics.value = c("歌詞URL"); F.note.value = c("メモ");
  F.title.textContent = r ? "曲を直す" : "曲を追加";
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
  const sel = A.returnTo;
  requestAnimationFrame(() => {
    const b = sel && document.querySelector(sel);
    // 戻り先のボタンが、閉じた作品の曲の一覧の中にあるとき（一覧を作り直すと、開いていた作品がまた閉じることがある）は、その作品を開いてから戻る
    const ol = b && b.closest(".song-items[hidden]");
    if (ol) { const fb = document.querySelector(`.song-fold-btn[aria-controls="${ol.id}"]`); if (fb) fb.click(); }
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
  F.foot.replaceChildren(
    h("p", { class: "hint", text: "この曲を楽曲一覧から消します（同じ曲がほかの作品の行にもあるときは、そちらは残ります）。" }),
    h("div", { class: "panelbtns" },
      h("button", { type: "button", class: "btn plain", "data-act": "back", text: "やめる" }),
      h("button", { type: "button", class: "btn danger", "data-act": "remove", text: "削除する" })));
}

// 入力した内容を、CSV の1行にする（知らない列は、もとの行のまま残す）
function formToCells() {
  const base = A.editing.index === null ? null : T.rows[A.editing.index];
  const map = { "曲名": oneLine(F.name.value), "読み": nf(F.yomi.value).replace(/\s+/g, ""), "初めて出た作品": oneLine(F.work.value), "種類": F.kind.value,
    "年": nf(F.y.value), "月": F.m.value, "日": F.d.value, "アルバム": oneLine(F.album.value), "タイアップ": oneLine(F.tieup.value),
    "歌詞URL": F.lyrics.value.trim(), "メモ": oneLine(F.note.value), "名義": F.artist.value === "RADWIMPS" ? "" : F.artist.value };
  return T.header.map((col, i) => (col in map ? String(map[col] ?? "") : base ? base[i] ?? "" : ""));
}
// サイトと同じ決まり（data.js の parseSongs）でチェックする
function validate() {
  if (!A.editing) return { errors: [] };
  const { index } = A.editing;
  const cells = formToCells();
  const others = T.rows.filter((_, i) => i !== index);
  const text = T.text([...others, cells]);
  const line = parseCSV(text).lines[others.length + 1];
  const res = T.parse(text);
  const errors = res.errors.filter((x) => x.line === line).map((x) => x.msg);
  // 同じ曲名の注意は、チェック用に並べ替えた CSV の行番号で出るので（本当の行番号とずれる）、番号を出さない文にする
  const warnings = res.warnings.filter((x) => x.line === line).map((x) => (/^曲名「.*」は \d+ 行目にもあります$/.test(x.msg)
    ? x.msg.replace(/は \d+ 行目にもあります$/, "は、ほかの行にもあります（シングルとアルバムの両方に入っている曲なら、そのままでかまいません）") : x.msg));
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
  const { index, orig } = A.editing;
  const isNew = index === null;
  if (!T.doOp({ type: isNew ? "add" : "edit", orig, cells })) { closeEditor(); toast("変わったところがないので、そのままにしました"); return; }
  show(); render();
  // 戻り先：直した（足した）曲の「直す」ボタン（日付を直して行が動いても、その行を探す）
  const idx = T.rows.findIndex((r) => toCSVLine(r) === toCSVLine(cells));
  const line = idx >= 0 ? parseCSV(T.text()).lines[idx + 1] : 0;
  if (line && document.querySelector(`[data-songedit="${line}"]`)) A.returnTo = `[data-songedit="${line}"]`;
  closeEditor();
  toast(`曲を${isNew ? "追加" : "直"}しました（まだ保存していません。一覧の上の「GitHub に保存」で保存します）`);
}
function removeRow() {
  T.doOp({ type: "delete", orig: A.editing.orig, cells: null });
  A.returnTo = "[data-songadd]"; // 消した曲のボタンはもうないので、楽曲の管理の欄へ戻る
  closeEditor();
  show(); render();
  toast("曲を削除しました（まだ保存していません）");
}
