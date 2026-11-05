// assets/admin.js
// 管理画面の「記事の管理」です。管理者モードの端末で、管理画面を開いたときだけ読み込まれます。
//   ・記事の一覧（非表示・リンク切れも含む）を見て、追加・編集・非表示・削除ができます。
//   ・「GitHub に保存」を押すと、GitHub の data/articles.csv が書き換わり、1〜2分でサイトに反映されます。
//   ・GitHub への書き込みには、管理者が GitHub で作った「合鍵」（アクセストークン）を使います。
//     合鍵はこの端末のブラウザにだけ保存し、GitHub（api.github.com）以外には送りません。
//   ・合鍵がなくても「保存せずに試す」で、一覧と編集画面を試せます（変更はファイルに書き出せます）。

import { parseCSV, parseArticles, toCSVLine, ARTICLE_HEADER, KIND_ORDER, MEMBERS, MEMBER_ORDER, LANGS, STATES, CATEGORIES, idFromUrl, youtubeId, VIDEO_KIND } from "./data.js";

const STORE_TOKEN = "radwimps-interview-index:gh-token";
const STORE_REPO = "radwimps-interview-index:gh-repo";
const API = "https://api.github.com";
const FILE = "data/articles.csv";
const PAGE = 40; // 一覧に一度に出す件数
// 合鍵を作る GitHub の画面。名前・説明・有効期限（90日）・許可（Contents の読み書き）と、
// 持ち主（Resource owner：リポジトリの持ち主。Organization ならその Organization）を入れた状態で開く
function tokenUrl() {
  const q = {
    name: "RADWIMPS Archive 運営管理",
    description: "RADWIMPS Archive の運営管理から、記事データ（data/articles.csv）を保存するための合鍵",
    expires_in: "90",
    contents: "write"
  };
  const owner = (A.repo || "").split("/")[0];
  if (/^[A-Za-z0-9-]+$/.test(owner)) q.target_name = owner;
  return "https://github.com/settings/personal-access-tokens/new?" + new URLSearchParams(q);
}

/* ---------- 小さな道具 ---------- */

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}
const nf = (s) => String(s ?? "").normalize("NFKC").trim();
const lsGet = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const lsSet = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* 保存できない環境 */ } };

function decodeBase64Utf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes); // 先頭の BOM も文字として残す
}
function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
// 「owner/repo」や「https://github.com/owner/repo」から「owner/repo」を取り出す
function repoName(s) {
  const m = nf(s).replace(/\.git$/, "").match(/^(?:https?:\/\/github\.com\/)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/?$/);
  return m ? `${m[1]}/${m[2]}` : "";
}

/* ---------- 状態 ---------- */

const A = {
  opts: null, root: null,
  mode: "off",        // off：つないでいない　connecting：接続中　github：GitHub とつながっている　practice：保存せずに試す
  error: "",
  token: "", repo: "", branch: "", sha: "",
  header: [], rows: [], baseRows: [], bom: true, eol: "\n",
  ops: [],            // 保存していない変更（GitHub 側が先に変わっていたときに、やり直すため）
  q: "", filter: "all", limit: PAGE,
  editing: null,      // 編集中の記事 { index, key }
  saving: false,
  wantNew: false,
  carry: false        // 合鍵が使えなくなったときなど：保存していない変更を、つなぎ直したあとに引き継ぐ
};

/* ---------- 表（CSV）の扱い ---------- */

const ci = (name) => {
  const i = A.header.indexOf(name);
  return i >= 0 ? i : name === "id" ? A.header.indexOf("ID") : -1;
};
const cell = (r, name) => { const i = ci(name); return i >= 0 ? String(r[i] ?? "").trim() : ""; };
const keyOf = (r) => cell(r, "id") || idFromUrl(cell(r, "URL")); // サイトと同じ決め方の id
const clone = (rows) => rows.map((r) => r.slice());

function loadTable(text) {
  A.bom = text.charCodeAt(0) === 0xfeff;
  A.eol = /\r\n/.test(text) ? "\r\n" : "\n";
  const { rows } = parseCSV(text);
  let header = (rows[0] || []).map((x) => String(x).replace(/^﻿/, "").trim());
  let body = rows.slice(1).filter((r) => r.some((c) => String(c).trim()));
  // 足りない列（古い CSV にはカテゴリの列がないなど）は、決まった順番の位置に足す
  if (!ARTICLE_HEADER.every((c) => header.includes(c) || (c === "id" && header.includes("ID")))) {
    const extra = header.filter((c) => !ARTICLE_HEADER.includes(c) && c !== "ID");
    const next = [...ARTICLE_HEADER, ...extra];
    body = body.map((r) => next.map((c) => { const i = header.indexOf(c === "id" && !header.includes("id") ? "ID" : c); return i >= 0 ? r[i] ?? "" : ""; }));
    header = next;
  }
  A.header = header;
  A.rows = body.map((r) => header.map((_, i) => r[i] ?? ""));
  A.baseRows = clone(A.rows);
  A.ops = [];
}
function serialize(rows = A.rows) {
  return (A.bom ? "﻿" : "") + [toCSVLine(A.header), ...rows.map(toCSVLine)].join(A.eol) + A.eol;
}
// 新しい日付が上になるように並べる（同じ日付の中では、もとの順番のまま）
function sortRows(rows) {
  const k = (r) => [nf(cell(r, "年")) || "0000", (nf(cell(r, "月")) || "0").padStart(2, "0"), (nf(cell(r, "日")) || "0").padStart(2, "0")].join("-");
  return rows.map((r, i) => [r, i]).sort((a, b) => (k(a[0]) < k(b[0]) ? 1 : k(a[0]) > k(b[0]) ? -1 : a[1] - b[1])).map(([r]) => r);
}
function applyOp(rows, op) {
  const i = rows.findIndex((r) => keyOf(r) === op.key);
  if (op.type === "delete") { if (i >= 0) rows.splice(i, 1); }
  else if (i >= 0) rows[i] = op.cells.slice();
  else rows.push(op.cells.slice());
  return sortRows(rows);
}
function doOp(op) {
  A.ops.push(op);
  A.rows = applyOp(A.rows, op);
}
// 保存していない変更の数（追加・修正・削除）
function summary() {
  const base = new Map(A.baseRows.map((r) => [keyOf(r), toCSVLine(r)]));
  const now = new Map(A.rows.map((r) => [keyOf(r), toCSVLine(r)]));
  let added = 0, edited = 0, deleted = 0;
  for (const [k, v] of now) { if (!base.has(k)) added++; else if (base.get(k) !== v) edited++; }
  for (const k of base.keys()) if (!now.has(k)) deleted++;
  return { added, edited, deleted, total: added + edited + deleted, base };
}

/* ---------- GitHub ---------- */

class GhError extends Error {}
async function gh(path, init = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      ...init, cache: "no-store",
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", Authorization: "Bearer " + A.token, ...(init.headers || {}) }
    });
  } catch {
    throw new GhError("GitHub につながりませんでした。通信の状態を確かめてください（claude.ai のプレビューでは GitHub につなげません。公開したサイトで使えます）。");
  }
  return res;
}
async function ghFail(res, what) {
  let msg = "";
  try { msg = (await res.json()).message || ""; } catch { /* 本文なし */ }
  // keyProblem：合鍵そのものの問題（登録し直してもらう）
  const err = (m, keyProblem = false) => Object.assign(new GhError(m), { keyProblem });
  if (res.status === 401) return err("合鍵（アクセストークン）が正しくないか、期限が切れています。新しい合鍵を作って、登録し直してください。", true);
  if (res.status === 403 && /rate limit/i.test(msg)) return err("GitHub の利用回数の上限に達しました。しばらく待ってから、もう一度試してください。");
  if (res.status === 403) return err("この合鍵には、記事データを書き換える許可がありません。「Contents」を「Read and write」にした合鍵を作って、登録し直してください。", true);
  if (res.status === 404) return err(`${what}が見つかりません。リポジトリ名（${A.repo}）と、合鍵を作るときに選んだリポジトリが合っているか確かめてください。`);
  return err(`GitHub でエラーが起きました（${res.status}${msg ? "：" + msg : ""}）。`);
}
// 合鍵を登録し直してもらう：保存していない変更は残しておき、つなぎ直したら続きから保存できるようにする
function dropKey(message) {
  lsSet(STORE_TOKEN, "");
  A.token = ""; A.mode = "off"; A.error = message;
  A.carry = summary().total > 0;
}
async function fetchFile() {
  const res = await gh(`/repos/${A.repo}/contents/${FILE}?ref=${encodeURIComponent(A.branch)}`);
  if (!res.ok) throw await ghFail(res, "記事データ（data/articles.csv）");
  const j = await res.json();
  let text = j.content ? decodeBase64Utf8(j.content) : "";
  if (!j.content) { // 1MB を超えるファイルは、別の形で受け取る
    const raw = await gh(`/repos/${A.repo}/contents/${FILE}?ref=${encodeURIComponent(A.branch)}`, { headers: { Accept: "application/vnd.github.raw+json" } });
    if (!raw.ok) throw await ghFail(raw, "記事データ（data/articles.csv）");
    text = await raw.text();
  }
  return { text, sha: j.sha };
}
// 引き継ぐ変更があれば、読み込み直した最新の記事データに重ねる
function loadWithCarry(text) {
  const carry = A.carry ? A.ops.slice() : [];
  loadTable(text);
  for (const op of carry) doOp(op);
  A.carry = false;
}
async function connect(token, repo) {
  A.token = token; A.repo = repo; A.mode = "connecting"; A.error = "";
  render();
  try {
    const res = await gh(`/repos/${repo}`);
    if (!res.ok) throw await ghFail(res, "リポジトリ");
    A.branch = (await res.json()).default_branch || "main";
    const { text, sha } = await fetchFile();
    loadWithCarry(text);
    A.sha = sha;
    A.mode = "github";
    lsSet(STORE_TOKEN, token);
    lsSet(STORE_REPO, repo);
  } catch (e) {
    A.mode = "off";
    A.error = e instanceof GhError ? e.message : "読み込めませんでした。";
    if (e.keyProblem) lsSet(STORE_TOKEN, ""); // 使えない合鍵は、次に開いたときに使わない
  }
  render();
  afterReady();
}
async function save() {
  if (A.saving || A.mode !== "github") return;
  const sum = summary();
  if (!sum.total) return;
  const check = parseArticles(serialize());
  if (check.errors.length) {
    A.filter = "issues"; A.limit = PAGE;
    render();
    toast(`直す必要がある問題が ${check.errors.length} 件あります。「要確認」の記事を直してから保存してください`);
    return;
  }
  A.saving = true;
  render();
  const message = `記事データを更新（運営管理から：追加 ${sum.added}・修正 ${sum.edited}・削除 ${sum.deleted}）`;
  const put = () => gh(`/repos/${A.repo}/contents/${FILE}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: encodeBase64Utf8(serialize()), sha: A.sha, branch: A.branch })
  });
  let merged = false, keyLost = false;
  try {
    let res = await put();
    if (res.status === 409 || res.status === 422) {
      // 開いている間に GitHub 側で記事データが変わっていた：最新を読み込み、今回の変更を重ねてからもう一度保存する
      const ops = A.ops.slice();
      const { text, sha } = await fetchFile();
      loadTable(text);
      A.sha = sha;
      for (const op of ops) doOp(op);
      merged = true;
      res = await put();
    }
    if (!res.ok) throw await ghFail(res, "記事データ（data/articles.csv）");
    A.sha = (await res.json()).content.sha;
    A.baseRows = clone(A.rows);
    A.ops = [];
    A.opts.onSaved(serialize());
    toast(merged ? "GitHub 側の新しい変更に重ねて保存しました。1〜2分でサイトに反映されます" : "GitHub に保存しました。1〜2分でサイトに反映されます");
  } catch (e) {
    if (e.keyProblem) { // 合鍵の期限切れなど：登録し直せば、続きから保存できる
      dropKey(e.message);
      keyLost = true;
      toast("保存できませんでした。合鍵を登録し直すと、続きから保存できます");
    } else toast(e instanceof GhError ? e.message : "保存できませんでした。もう一度試してください");
  }
  A.saving = false;
  render();
  if (keyLost) A.root.scrollIntoView({ block: "start", behavior: "smooth" }); // 理由と、合鍵の欄が見える所へ
}
async function startPractice() {
  A.mode = "connecting"; A.error = "";
  render();
  try {
    const res = await fetch("data/articles.csv", { cache: "no-cache" });
    if (!res.ok) throw new Error();
    loadWithCarry(await res.text());
    A.mode = "practice";
  } catch {
    A.mode = "off";
    A.error = "記事データを読み込めませんでした。";
  }
  render();
  afterReady();
}
function exportCsv() {
  const url = URL.createObjectURL(new Blob([serialize()], { type: "text/csv" }));
  const a = h("a", { href: url, download: "articles.csv" });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast("articles.csv を書き出しました。GitHub の data フォルダに上書きでアップロードすると反映されます");
}

/* ---------- 画面 ---------- */

const toast = (m) => A.opts.toast(m);

export function mountAdmin(root, opts) {
  if (A.root) return api;
  A.root = root; A.opts = opts;
  A.repo = repoName(lsGet(STORE_REPO)) || repoName(opts.repo || "");
  const token = lsGet(STORE_TOKEN);
  setupSheet();
  window.addEventListener("beforeunload", (e) => { if (summary().total && (A.mode !== "off" || A.carry)) { e.preventDefault(); e.returnValue = ""; } });
  if (token && A.repo) connect(token, A.repo); else render();
  return api;
}
const api = {
  // メニューの「記事を追加」から：読み込み中なら、読み込みが終わってから追加の画面を開く
  openNew() {
    if (A.mode === "github" || A.mode === "practice") openEditor(null);
    else if (A.mode === "connecting") A.wantNew = true;
    else { A.wantNew = true; toast("先に GitHub とつなぐか「保存せずに試す」を押すと、記事を追加する画面が開きます"); }
  }
};
function afterReady() {
  if (A.wantNew && (A.mode === "github" || A.mode === "practice")) { A.wantNew = false; openEditor(null); }
  A.wantNew = false;
}

function render() {
  const root = A.root;
  if (!root) return;
  if (A.mode === "off") return root.replaceChildren(connectView());
  if (A.mode === "connecting") return root.replaceChildren(h("p", { class: "hint", text: "記事データを読み込んでいます…" }));
  root.replaceChildren(statusLine(), toolbar(), listView(), pendingBar());
}

function connectView() {
  const box = h("div", { class: "admconnect" });
  if (A.error) box.append(h("p", { class: "msg err", role: "alert", text: A.error }));
  const repoIn = h("input", { id: "ghRepo", type: "text", autocomplete: "off", spellcheck: "false", placeholder: "ユーザー名/リポジトリ名", value: A.repo });
  const tokIn = h("input", { id: "ghToken", type: "password", autocomplete: "off", spellcheck: "false", placeholder: "github_pat_ から始まる文字" });
  const go = h("button", { type: "button", class: "btn primary", text: "GitHub とつなぐ" });
  go.addEventListener("click", () => {
    const repo = repoName(repoIn.value), token = nf(tokIn.value);
    if (!repo) { A.error = "リポジトリは「ユーザー名/リポジトリ名」の形で入れてください（例：yourname/radwimps-interview-index）。"; return render(); }
    if (!token) { A.error = "合鍵（アクセストークン）を貼り付けてください。"; return render(); }
    connect(token, repo);
  });
  const practice = h("button", { type: "button", class: "btn", text: "保存せずに試す" });
  practice.addEventListener("click", startPractice);
  const sum = summary();
  if (A.carry && sum.total) {
    const drop = h("button", { type: "button", class: "linkbtn", text: "変更を捨てる" });
    drop.addEventListener("click", () => {
      if (!confirmInline(drop, "もう一度押すと、保存していない変更を捨てます")) return;
      A.carry = false; A.rows = clone(A.baseRows); A.ops = []; render(); toast("変更を捨てました");
    });
    box.append(h("div", { class: "admcarry" }, h("p", { class: "msg", text: `保存していない変更が ${sum.total} 件あります。合鍵を登録し直してつなぐと、続きから保存できます。` }), drop));
  }
  const repoShort = A.repo ? A.repo.split("/")[1] : "";
  box.append(
    h("p", { text: "記事の追加・編集を GitHub に保存するには、最初に一度だけ、このサイト専用の「合鍵」（アクセストークン）を GitHub で作って登録します。" }),
    h("ol", { class: "admsteps" },
      h("li", null, h("a", { href: tokenUrl(), target: "_blank", rel: "noopener noreferrer", text: "GitHub の合鍵を作る画面" }), document.createTextNode(` を開きます（GitHub へのログインが必要です）。名前・有効期限（90日）・許可${A.repo ? `・持ち主（Resource owner：${A.repo.split("/")[0]}）` : ""}は、入った状態で開きます。`)),
      h("li", { text: `「Repository access」で「Only select repositories」を選び、${repoShort ? `「${repoShort}」` : "このサイトのリポジトリ"}だけを選びます。` }),
      h("li", { text: "「Permissions」に「Contents」の「Read and write」があることを確かめて、いちばん下の「Generate token」を押します（確認が出たら、もう一度押します）。" }),
      h("li", { text: "表示された合鍵（github_pat_ から始まる文字）をコピーして、下に貼り付けます。合鍵は一度しか表示されません。" })),
    h("label", { class: "admfield", for: "ghRepo" }, "リポジトリ", repoIn),
    h("label", { class: "admfield", for: "ghToken" }, "合鍵（アクセストークン）", tokIn),
    h("p", { class: "hint", text: "合鍵はこの端末のブラウザにだけ保存され、GitHub 以外には送りません。共用のパソコンでは登録しないでください。" }),
    h("div", { class: "panelbtns" }, go, practice));
  return box;
}

function statusLine() {
  const box = h("div", { class: "admstatus" });
  if (A.mode === "github") {
    const off = h("button", { type: "button", class: "linkbtn", text: "合鍵を消す" });
    off.addEventListener("click", () => {
      dropKey("");
      render();
      toast(A.carry ? "この端末から合鍵を消しました。保存していない変更は、つなぎ直すまで残っています" : "この端末から合鍵を消しました");
    });
    box.append(h("p", null, h("span", { class: "dot ok", "aria-hidden": "true" }), `GitHub につながっています（${A.repo}・${A.branch}）`), off);
  } else {
    const back = h("button", { type: "button", class: "linkbtn", text: "GitHub とつなぐ" });
    back.addEventListener("click", () => {
      if (summary().total && !confirmInline(back, "保存していない変更があります。もう一度押すと、変更を捨てます。")) return;
      A.mode = "off"; A.carry = false; A.rows = clone(A.baseRows); A.ops = []; render();
    });
    box.append(h("p", null, h("span", { class: "dot", "aria-hidden": "true" }), "保存せずに試しています（変更は GitHub に保存されません）"), back);
  }
  return box;
}
// 確認ダイアログの代わり：1回目はボタンの文字を変えて知らせ、3秒以内にもう一度押したら実行する
function confirmInline(btn, msg) {
  if (btn.dataset.armed === "1") return true;
  btn.dataset.armed = "1";
  toast(msg);
  setTimeout(() => { btn.dataset.armed = ""; }, 3000);
  return false;
}

function rowIssues() {
  const text = serialize();
  const { lines } = parseCSV(text);
  const res = parseArticles(text);
  const byLine = new Map();
  for (const e of res.errors) (byLine.get(e.line) || byLine.set(e.line, { e: [], w: [] }).get(e.line)).e.push(e.msg);
  for (const w of res.warnings) (byLine.get(w.line) || byLine.set(w.line, { e: [], w: [] }).get(w.line)).w.push(w.msg);
  return A.rows.map((_, i) => byLine.get(lines[i + 1]) || { e: [], w: [] });
}

function toolbar() {
  const add = h("button", { type: "button", class: "btn primary", text: "＋ 記事を追加" });
  add.addEventListener("click", () => openEditor(null));
  const q = h("input", { type: "search", class: "admq", placeholder: "タイトル・媒体・URL で探す", value: A.q, "aria-label": "運営管理の記事を探す" });
  q.addEventListener("input", () => { A.q = q.value; A.limit = PAGE; renderList(); });
  const issues = rowIssues();
  const counts = { all: A.rows.length, issues: issues.filter((x) => x.e.length || x.w.length).length };
  for (const s of STATES) counts[s] = A.rows.filter((r) => (nf(cell(r, "状態")) || "公開") === s).length;
  const chips = h("div", { class: "chips", role: "group", "aria-label": "表示する記事" },
    ...[["all", "すべて"], ...STATES.map((s) => [s, s]), ["issues", "要確認"]].map(([v, l]) => {
      const b = h("button", { type: "button", class: "chip", "aria-pressed": String(A.filter === v) }, l, h("span", { class: "n", text: counts[v] }));
      b.addEventListener("click", () => { A.filter = v; A.limit = PAGE; render(); });
      return b;
    }));
  return h("div", { class: "admtools" }, h("div", { class: "admrow" }, add, q), chips);
}

let listBox = null;
function listView() {
  listBox = h("div", { class: "admlistwrap" });
  renderList();
  return listBox;
}
function renderList() {
  if (!listBox) return;
  const issues = rowIssues();
  const sum = summary();
  const terms = nf(A.q).toLowerCase().split(/\s+/).filter(Boolean);
  const shown = [];
  A.rows.forEach((r, i) => {
    const st = nf(cell(r, "状態")) || "公開";
    if (A.filter === "issues" ? !(issues[i].e.length || issues[i].w.length) : A.filter !== "all" && st !== A.filter) return;
    const hay = [cell(r, "タイトル"), cell(r, "媒体"), cell(r, "URL"), keyOf(r), cell(r, "メモ"), cell(r, "説明"), cell(r, "ライブ名")].join(" ").normalize("NFKC").toLowerCase();
    if (terms.some((t) => !hay.includes(t))) return;
    shown.push(i);
  });
  const ul = h("ul", { class: "admlist" });
  for (const i of shown.slice(0, A.limit)) {
    const r = A.rows[i], st = nf(cell(r, "状態")) || "公開", key = keyOf(r);
    const isNew = !sum.base.has(key), changed = !isNew && sum.base.get(key) !== toCSVLine(r);
    const date = [cell(r, "年"), cell(r, "月"), cell(r, "日")].filter(Boolean).join(".") || "日付なし";
    const flags = [
      isNew ? h("span", { class: "flag new", text: "新規" }) : changed ? h("span", { class: "flag mod", text: "変更あり" }) : null,
      issues[i].e.length ? h("span", { class: "flag err", text: "要修正" }) : issues[i].w.length ? h("span", { class: "flag warn", text: "注意" }) : null
    ];
    const b = h("button", { type: "button", class: "admitem", "data-i": i },
      h("span", { class: "admmeta" }, h("span", { class: "st st-" + STATES.indexOf(st), text: st }), h("span", { text: date }), h("span", { class: "admmedia", text: cell(r, "媒体") }), ...flags),
      h("span", { class: "admtitle", text: cell(r, "タイトル") || "（タイトルなし）" }));
    b.addEventListener("click", () => openEditor(i));
    ul.append(h("li", null, b));
  }
  const parts = [h("p", { class: "count", text: shown.length === A.rows.length ? `${A.rows.length} 件` : `${shown.length} 件（全 ${A.rows.length} 件）` })];
  parts.push(shown.length ? ul : h("p", { class: "hint", text: "当てはまる記事はありません。" }));
  if (shown.length > A.limit) {
    const more = h("button", { type: "button", class: "btn", text: `さらに表示（残り ${shown.length - A.limit} 件）` });
    more.addEventListener("click", () => { A.limit += PAGE * 2; renderList(); });
    parts.push(more);
  }
  listBox.replaceChildren(...parts);
}

function pendingBar() {
  const sum = summary();
  const bar = h("div", { class: "admbar" + (sum.total ? " on" : ""), role: "region", "aria-label": "保存していない変更" });
  if (!sum.total) {
    bar.append(h("p", { class: "hint", text: A.mode === "github" ? "記事を押すと編集できます。変更は「GitHub に保存」を押すまで反映されません。" : "記事を押すと編集を試せます。" }));
    return bar;
  }
  const discard = h("button", { type: "button", class: "btn plain", text: "取り消す" });
  discard.addEventListener("click", () => {
    if (!confirmInline(discard, "もう一度押すと、保存していない変更をすべて取り消します")) return;
    A.rows = clone(A.baseRows); A.ops = []; render(); toast("変更を取り消しました");
  });
  const label = h("p", { class: "admsum" }, h("b", { text: `保存していない変更 ${sum.total} 件` }), h("span", { text: `追加 ${sum.added}・修正 ${sum.edited}・削除 ${sum.deleted}` }));
  if (A.mode === "github") {
    const saveBtn = h("button", { type: "button", class: "btn primary", disabled: A.saving, text: A.saving ? "保存しています…" : "GitHub に保存" });
    saveBtn.addEventListener("click", save);
    bar.append(label, h("div", { class: "panelbtns" }, discard, saveBtn));
  } else {
    const ex = h("button", { type: "button", class: "btn primary", text: "ファイルに書き出す" });
    ex.addEventListener("click", exportCsv);
    bar.append(label, h("div", { class: "panelbtns" }, discard, ex));
  }
  return bar;
}

/* ---------- 編集画面（画面の下から出てくるパネル） ---------- */

const F = {}; // 編集画面の入力欄
const $s = (sel) => document.querySelector(sel);

function setupSheet() {
  const form = $s("#editForm");
  const opt = (v, t = v) => h("option", { value: v, text: t });
  const field = (label, control, hint) => h("label", { class: "admfield" }, label, control, hint ? h("small", { text: hint }) : null);
  const checks = (name, items) => h("div", { class: "chips", role: "group", "aria-label": name },
    ...items.map(([v, l]) => h("label", { class: "chip check" }, h("input", { type: "checkbox", value: v, "data-g": name }), l)));

  F.state = h("div", { class: "chips", role: "radiogroup", "aria-label": "状態" },
    ...STATES.map((s) => h("label", { class: "chip check" }, h("input", { type: "radio", name: "editState", value: s }), s)));
  F.url = h("input", { type: "url", inputmode: "url", autocomplete: "off", spellcheck: "false", placeholder: "https://" });
  F.title = h("textarea", { rows: "2" });
  F.media = h("input", { type: "text", autocomplete: "off", list: "mediaList" });
  F.mediaList = h("datalist", { id: "mediaList" });
  F.y = h("input", { type: "text", inputmode: "numeric", pattern: "[0-9]*", maxlength: "4", autocomplete: "off", placeholder: "2026", "aria-label": "年" });
  F.m = h("select", { "aria-label": "月" }, opt("", "—"), ...Array.from({ length: 12 }, (_, i) => opt(String(i + 1))));
  F.d = h("select", { "aria-label": "日" }, opt("", "—"), ...Array.from({ length: 31 }, (_, i) => opt(String(i + 1))));
  F.kind = h("select", null);
  F.cats = checks("cats", CATEGORIES.map((c) => [c.name, c.name]));
  F.members = checks("members", MEMBER_ORDER.map((k) => [k, MEMBERS[k].name]));
  F.guests = h("input", { type: "text", autocomplete: "off", placeholder: "例：藤井道人、n-buna（ヨルシカ）" });
  F.tags = h("input", { type: "text", autocomplete: "off", placeholder: "例：#汝、星のごとく #映画" });
  F.lang = h("select", null, ...Object.keys(LANGS).map((l) => opt(l)));
  F.note = h("textarea", { rows: "2" });
  F.summary = h("textarea", { rows: "3" });
  F.eventDate = h("input", { type: "text", inputmode: "numeric", autocomplete: "off", placeholder: "例：2025-12-27" });
  F.eventName = h("input", { type: "text", autocomplete: "off", list: "eventList", placeholder: "例：20th ANNIVERSARY LIVE TOUR" });
  F.eventList = h("datalist", { id: "eventList" });
  F.venue = h("input", { type: "text", autocomplete: "off", placeholder: "例：有明アリーナ" });
  F.id = h("input", { type: "text", autocomplete: "off", spellcheck: "false" });
  F.issues = h("div", { class: "editissues", "aria-live": "polite" });

  form.replaceChildren(
    h("div", { class: "fgroup" }, h("h3", { text: "状態" }), F.state),
    field("記事の URL（必須）", F.url),
    field("タイトル（必須）", F.title),
    field("媒体（必須）", F.media), F.mediaList,
    h("div", { class: "admfield" }, h("span", { text: "掲載日（わかる所まで）" }),
      h("div", { class: "datein" }, F.y, h("span", { text: "年" }), F.m, h("span", { text: "月" }), F.d, h("span", { text: "日" }))),
    field("種類", F.kind),
    h("div", { class: "fgroup" }, h("h3", { text: "カテゴリ（記事が生まれたきっかけ。いくつでも）" }), F.cats),
    h("div", { class: "fgroup" }, h("h3", { text: "登場するメンバー" }), F.members),
    field("対談相手・話し手（「、」で区切る）", F.guests),
    field("タグ（1つずつ # を付ける）", F.tags),
    field("言語", F.lang),
    field("説明（「説明を開く」で出る紹介文。本文の書き写しではなく、自分の言葉で）", F.summary),
    field("メモ", F.note, "日付の根拠や、閲覧の条件など。「説明を開く」の中に小さく出ます。"),
    h("div", { class: "fgroup" }, h("h3", { text: "ライブの情報（ライブレポートのとき）" }),
      h("div", { class: "admtools" },
        field("公演日", F.eventDate, "年-月-日で書きます。同じ公演日・ライブ名・会場の記事は、まとめて表示されます。"),
        field("ライブ名（ツアー・イベント）", F.eventName), F.eventList,
        field("会場", F.venue))),
    field("id", F.id, "空欄なら URL から自動で作ります。あとで読む・既読の目印なので、今ある記事の id は変えないでください。"),
    F.issues);

  form.addEventListener("input", onFormInput);
  form.addEventListener("change", onFormInput);
  form.addEventListener("submit", (e) => e.preventDefault());
  $s("#editSheet").addEventListener("click", (e) => {
    const b = e.target.closest("[data-edit]");
    if (!b) return;
    const act = b.dataset.edit;
    if (act === "cancel") closeEditor();
    else if (act === "apply") applyEdit();
    else if (act === "delete") showDeleteConfirm();
    else if (act === "hide") { setState("非表示"); applyEdit(); }
    else if (act === "remove") removeRow();
    else if (act === "back") renderFoot();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$s("#editSheet").hidden) closeEditor(); });
}

function setState(s) { for (const r of F.state.querySelectorAll("input")) r.checked = r.value === s; }
function checked(group) { return [...$s("#editForm").querySelectorAll(`input[data-g="${group}"]:checked`)].map((x) => x.value); }

function emptyDraft() {
  return { state: "公開", y: String(new Date().getFullYear()), m: "", d: "", media: "", kind: "インタビュー", cats: [], title: "", url: "", members: [], guests: "", tags: "", lang: "日本語", note: "", summary: "", eventDate: "", eventName: "", venue: "", id: "" };
}
// CSV の1行を、編集画面の値にする（書き方の揺れは、サイトと同じ読み方でそろえる）
function rowToDraft(r) {
  const it = parseArticles(toCSVLine(A.header) + "\n" + toCSVLine(r)).items[0];
  const [y, m, d] = it && it.date ? it.date.split("-") : [nf(cell(r, "年")), nf(cell(r, "月")), nf(cell(r, "日"))];
  const memberKeys = (s) => s.split(/[、,，・\/／]/).map(nf).filter(Boolean).map((n) => MEMBER_ORDER.find((k) => MEMBERS[k].aliases.includes(n))).filter(Boolean);
  return {
    state: it ? it.state : nf(cell(r, "状態")) || "公開",
    y: y || "", m: m ? String(+m) : "", d: d ? String(+d) : "",
    media: cell(r, "媒体"), kind: it ? it.kind : nf(cell(r, "種類")) || "インタビュー",
    cats: it ? it.categories : cell(r, "カテゴリ").split(/[、,，]/).map(nf).filter(Boolean),
    title: cell(r, "タイトル"), url: cell(r, "URL"),
    members: it ? it.members : memberKeys(cell(r, "メンバー")),
    guests: cell(r, "対談相手"),
    tags: it ? it.tags.map((t) => "#" + t).join(" ") : cell(r, "タグ"),
    lang: it ? Object.keys(LANGS).find((k) => LANGS[k] === it.lang) || cell(r, "言語") || "日本語" : cell(r, "言語") || "日本語",
    note: cell(r, "メモ"), summary: cell(r, "説明"), eventDate: it ? it.eventDate : cell(r, "公演日"), eventName: cell(r, "ライブ名"), venue: cell(r, "会場"),
    id: cell(r, "id")
  };
}
function readForm() {
  const st = F.state.querySelector("input:checked");
  return {
    state: st ? st.value : "公開", y: nf(F.y.value), m: F.m.value, d: F.d.value, media: F.media.value.trim(), kind: F.kind.value,
    cats: checked("cats"), title: F.title.value.replace(/\s*\n\s*/g, " ").trim(), url: F.url.value.trim(), members: checked("members"),
    guests: F.guests.value.trim(), tags: F.tags.value.trim(), lang: F.lang.value, note: F.note.value.trim(),
    summary: F.summary.value.replace(/\s*\n\s*/g, " ").trim(), eventDate: nf(F.eventDate.value), eventName: F.eventName.value.trim(), venue: F.venue.value.trim(),
    id: F.id.value.trim()
  };
}
function draftToCells(d, base) {
  const map = {
    "状態": d.state, "年": d.y, "月": d.m, "日": d.d, "媒体": d.media, "種類": d.kind, "カテゴリ": d.cats.join("、"), "タイトル": d.title, "URL": d.url,
    "メンバー": d.members.map((k) => MEMBERS[k].name).join("、"), "対談相手": d.guests, "タグ": d.tags, "言語": d.lang, "メモ": d.note,
    "説明": d.summary, "公演日": d.eventDate, "ライブ名": d.eventName, "会場": d.venue, "id": d.id, "ID": d.id
  };
  return A.header.map((col, i) => (col in map ? String(map[col] ?? "") : base ? base[i] ?? "" : ""));
}

function openEditor(index) {
  const isNew = index === null;
  const r = isNew ? null : A.rows[index];
  const d = isNew ? emptyDraft() : rowToDraft(r);
  A.editing = { index, key: isNew ? null : keyOf(r) };
  // 種類と媒体の選択肢（データにだけある値も出す）
  const kinds = [...KIND_ORDER, ...new Set(A.rows.map((x) => nf(cell(x, "種類"))).filter((k) => k && !KIND_ORDER.includes(k)))];
  if (d.kind && !kinds.includes(d.kind)) kinds.push(d.kind);
  F.kind.replaceChildren(...kinds.map((k) => h("option", { value: k, text: k })));
  F.mediaList.replaceChildren(...[...new Set(A.rows.map((x) => cell(x, "媒体")).filter(Boolean))].sort().map((m) => h("option", { value: m })));
  setState(d.state);
  F.url.value = d.url; F.title.value = d.title; F.media.value = d.media; F.y.value = d.y; F.m.value = d.m; F.d.value = d.d; F.kind.value = d.kind;
  for (const x of $s("#editForm").querySelectorAll('input[data-g="cats"]')) x.checked = d.cats.includes(x.value);
  for (const x of $s("#editForm").querySelectorAll('input[data-g="members"]')) x.checked = d.members.includes(x.value);
  F.guests.value = d.guests; F.tags.value = d.tags; F.lang.value = d.lang; F.note.value = d.note; F.id.value = d.id;
  F.summary.value = d.summary; F.eventDate.value = d.eventDate; F.eventName.value = d.eventName; F.venue.value = d.venue;
  F.eventList.replaceChildren(...[...new Set(A.rows.map((x) => cell(x, "ライブ名")).filter(Boolean))].sort().map((n) => h("option", { value: n })));
  F.id.readOnly = !isNew && !!d.id;
  $s("#editTitle").textContent = isNew ? "記事を追加" : "記事を編集";
  renderFoot();
  validate();
  const sheet = $s("#editSheet");
  sheet.hidden = false;
  document.documentElement.classList.add("locked");
  $s("#editForm").scrollTop = 0;
  (isNew ? F.url : $s("#editTitle").parentElement.querySelector("[data-edit='cancel']")).focus({ preventScroll: true });
}
function closeEditor() {
  $s("#editSheet").hidden = true;
  document.documentElement.classList.remove("locked");
  A.editing = null;
}
function renderFoot() {
  const foot = $s("#editFoot");
  const isNew = !A.editing || A.editing.index === null;
  foot.replaceChildren(
    isNew ? h("span") : h("button", { type: "button", class: "btn plain danger", "data-edit": "delete", text: "削除" }),
    h("button", { type: "button", class: "btn primary", "data-edit": "apply", text: isNew ? "追加する" : "この内容にする" }));
  validate();
}
function showDeleteConfirm() {
  $s("#editFoot").replaceChildren(
    h("p", { class: "hint", text: "消すかわりに「非表示」にすると、同じ記事をうっかり追加し直すのを防げます。" }),
    h("div", { class: "panelbtns" },
      h("button", { type: "button", class: "btn plain", "data-edit": "back", text: "やめる" }),
      h("button", { type: "button", class: "btn", "data-edit": "hide", text: "非表示にする" }),
      h("button", { type: "button", class: "btn danger", "data-edit": "remove", text: "削除する" })));
}

function onFormInput(e) {
  // YouTube の URL を入れたら、種類を「動画」・媒体を「YouTube」にする（まだ選んでいないとき）
  if (e && e.target === F.url && youtubeId(F.url.value.trim())) {
    if (F.kind.value === "インタビュー") F.kind.value = VIDEO_KIND;
    if (!F.media.value.trim()) F.media.value = "YouTube";
  }
  validate();
}
// 入力した内容を、サイトと同じ決まりでチェックする（ほかの記事と id・URL が重なっていないかも）
function validate() {
  if (!A.editing) return { errors: [] };
  const d = readForm();
  const others = A.rows.filter((_, i) => i !== A.editing.index);
  const cells = draftToCells(d, A.editing.index === null ? null : A.rows[A.editing.index]);
  const text = serialize([...others, cells]);
  const { lines } = parseCSV(text);
  const line = lines[others.length + 1];
  const res = parseArticles(text);
  const errors = res.errors.filter((x) => x.line === line).map((x) => x.msg);
  const warnings = res.warnings.filter((x) => x.line === line).map((x) => x.msg);
  F.issues.replaceChildren(...[
    ...errors.map((m) => h("p", { class: "msg err", text: "直してください：" + m })),
    ...warnings.map((m) => h("p", { class: "msg", text: "注意：" + m })),
    !errors.length && !warnings.length ? h("p", { class: "ok", text: "この内容は、書式のチェックを通ります。" }) : null].filter(Boolean));
  const apply = $s('#editFoot [data-edit="apply"]');
  if (apply) apply.disabled = errors.length > 0;
  return { errors, cells };
}

function applyEdit() {
  const { errors, cells } = validate();
  if (errors.length) return;
  const isNew = A.editing.index === null;
  doOp({ type: isNew ? "add" : "edit", key: isNew ? keyOf(cells) : A.editing.key, cells });
  closeEditor();
  render();
  toast(isNew ? "記事を追加しました（まだ保存していません）" : "変更しました（まだ保存していません）");
}
function removeRow() {
  doOp({ type: "delete", key: A.editing.key });
  closeEditor();
  render();
  toast("記事を削除しました（まだ保存していません）");
}
