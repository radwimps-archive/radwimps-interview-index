// assets/csv-table.js
// 年表の管理（admin-history.js）で使う、CSV の表と「まだ保存していない変更」の記録です。画面には関係しないので、tests/csv-table.test.mjs で確かめています。

import { parseCSV, toCSVLine } from "./data.js";

const nf = (s) => String(s ?? "").normalize("NFKC").trim();

// 行を見分ける目印は「読み込んだときの行の中身」（年表の CSV には id の列がないため）。
// GitHub 側が先に変わっていたときは、最新の CSV にこの目印で変更を重ね直す。
export class Table {
  constructor({ file, what, label, parse, newestFirst }) {
    Object.assign(this, { file, what, label, parse, newestFirst });
    this.header = []; this.rows = []; this.base = []; this.ops = []; this.bom = true; this.eol = "\n"; this.sha = "";
  }
  load(text) {
    this.bom = text.charCodeAt(0) === 0xfeff;
    this.eol = /\r\n/.test(text) ? "\r\n" : "\n";
    const { rows } = parseCSV(text);
    this.header = (rows[0] || []).map((x) => String(x).replace(/^﻿/, "").trim());
    this.rows = rows.slice(1).filter((r) => r.some((c) => String(c).trim())).map((r) => this.header.map((_, i) => r[i] ?? ""));
    this.base = this.rows.map((r) => r.slice());
    this.ops = [];
  }
  text(rows = this.rows) {
    return (this.bom ? "﻿" : "") + [toCSVLine(this.header), ...rows.map(toCSVLine)].join(this.eol) + this.eol;
  }
  col(name) { return this.header.indexOf(name); }
  cell(r, name) { const i = this.col(name); return i >= 0 ? String(r[i] ?? "").trim() : ""; }
  // CSV の行番号（parse の line）→ rows の何番目か
  indexOfLine(line) {
    const { lines } = parseCSV(this.text());
    const r = lines.indexOf(line);
    return r >= 1 ? r - 1 : -1;
  }
  // 日付の順の位置に入れる（年表は古い順、特設サイトは新しい順。同じ日付なら、同じ日付の最後に）
  insertSorted(rows, cells) {
    const key = (r) => [nf(this.cell(r, "年")) || "0000", (nf(this.cell(r, "月")) || "0").padStart(2, "0"), (nf(this.cell(r, "日")) || "0").padStart(2, "0")].join("-");
    const k = key(cells);
    const i = rows.findIndex((r) => (this.newestFirst ? key(r) < k : key(r) > k));
    rows.splice(i < 0 ? rows.length : i, 0, cells);
  }
  // 戻り値：直す・消すはずの行が見つからなかったら false（GitHub 側で、同じ行が先に直されていた）
  applyOp(rows, op) {
    const i = op.orig == null ? -1 : rows.findIndex((r) => toCSVLine(r) === op.orig);
    if (op.type === "delete") { if (i >= 0) rows.splice(i, 1); return i >= 0; }
    if (i >= 0) rows[i] = op.cells.slice();
    else this.insertSorted(rows, op.cells.slice()); // 追加（直した行が GitHub 側で直されていたときも、消えないように追加として残す）
    return op.orig == null || i >= 0;
  }
  // 変更を記録する。同じ行を何度も直したときは、1つの変更にまとめる
  doOp(op) {
    const prev = op.orig == null ? null : this.ops.find((p) => p.cells && toCSVLine(p.cells) === op.orig);
    if (prev) {
      if (op.type === "delete") {
        if (prev.type === "add") this.ops.splice(this.ops.indexOf(prev), 1);
        else { prev.type = "delete"; prev.cells = null; }
      } else prev.cells = op.cells.slice();
    } else this.ops.push({ ...op, cells: op.cells ? op.cells.slice() : null });
    this.applyOp(this.rows, op);
  }
  counts() {
    const c = { add: 0, edit: 0, delete: 0 };
    for (const op of this.ops) c[op.type]++;
    return { ...c, total: this.ops.length };
  }
  reset() { this.rows = this.base.map((r) => r.slice()); this.ops = []; }
  // 最新の CSV を読み込み直して、まだ保存していない変更を重ねる。戻り値：重ねられなかった変更の数
  //   （GitHub 側で同じ行が先に直されていたとき。直した内容は追加の行として残るので、年表で見比べて、いらないほうを消してもらう）
  reload(text) {
    const ops = this.ops;
    this.load(text);
    let lost = 0;
    for (const op of ops) {
      if (!this.applyOp(this.rows, op)) { lost++; if (op.type === "edit") { this.ops.push({ ...op, type: "add", orig: null }); } continue; }
      this.ops.push(op);
    }
    return lost;
  }
  errors() { return this.parse(this.text()).errors; }
}

