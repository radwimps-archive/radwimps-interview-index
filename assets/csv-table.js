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
  dateKey(r) { return [nf(this.cell(r, "年")) || "0000", (nf(this.cell(r, "月")) || "0").padStart(2, "0"), (nf(this.cell(r, "日")) || "0").padStart(2, "0")].join("-"); }
  insertSorted(rows, cells) {
    const k = this.dateKey(cells);
    const i = rows.findIndex((r) => (this.newestFirst ? this.dateKey(r) < k : this.dateKey(r) > k));
    rows.splice(i < 0 ? rows.length : i, 0, cells);
  }
  // 変更を rows に当てる。戻り値：当てられたら true。直す・消すはずの行が見つからなければ false（GitHub 側で、同じ行が先に直されていた）
  applyOp(rows, op) {
    const i = op.orig == null ? -1 : rows.findIndex((r) => toCSVLine(r) === op.orig);
    if (op.type === "delete") { if (i >= 0) rows.splice(i, 1); return i >= 0; }
    if (op.type === "edit" && i >= 0) {
      // 日付を直したときは、CSV の中でも日付の順の位置へ動かす
      if (this.dateKey(rows[i]) !== this.dateKey(op.cells)) { rows.splice(i, 1); this.insertSorted(rows, op.cells.slice()); }
      else rows[i] = op.cells.slice();
      return true;
    }
    this.insertSorted(rows, op.cells.slice()); // 追加（直した行が GitHub 側で直されていたときも、消えないように追加として残す）
    return op.type === "add";
  }
  // 変更を記録する。戻り値：記録したら true（中身が変わらない「直す」は記録しない）。
  // 同じ行を何度も直したときは、1つの変更にまとめる（直してもとに戻したら、変更はなくなる）
  doOp(op) {
    if (op.type === "edit" && toCSVLine(op.cells) === op.orig) return false;
    const prev = op.orig == null ? null : this.ops.find((p) => p.cells && toCSVLine(p.cells) === op.orig);
    if (prev) {
      if (op.type === "delete") {
        if (prev.type === "add") this.ops.splice(this.ops.indexOf(prev), 1);
        else { prev.type = "delete"; prev.cells = null; }
      } else {
        prev.cells = op.cells.slice();
        if (prev.type === "edit" && toCSVLine(prev.cells) === prev.orig) this.ops.splice(this.ops.indexOf(prev), 1);
      }
    } else this.ops.push({ ...op, cells: op.cells ? op.cells.slice() : null });
    // 読み込んだときの表に、変更を順に当て直す（直してもとに戻したとき、行の位置も読み込んだときのままにするため）
    this.rows = this.base.map((r) => r.slice());
    for (const o of this.ops) this.applyOp(this.rows, o);
    return true;
  }
  counts() {
    const c = { add: 0, edit: 0, delete: 0 };
    for (const op of this.ops) c[op.type]++;
    return { ...c, total: this.ops.length };
  }
  reset() { this.rows = this.base.map((r) => r.slice()); this.ops = []; }
  // 最新の CSV を読み込み直して、まだ保存していない変更を重ねる。戻り値：{ lost, gone }
  //   ・当て済みとして捨てるもの（前の保存が、返事が届かなかっただけで済んでいたなど）：
  //       追加 … 同じ行がもうある　／　直す … もとの行がもうなく、直したあとの行がもうある
  //   ・lost：直すはずの行が、別の場所で先に直されていた数（直した内容は追加の行として残す。年表で見比べて、いらないほうを消してもらう）
  //   ・gone：消すはずの行が見つからなかった数（別の場所でも消していたか、別の場所で直されていた。消す変更は捨てるので、年表で確かめてもらう）
  reload(text) {
    const ops = this.ops;
    this.load(text);
    let lost = 0, gone = 0;
    // 「もうあるか」は、読み込んだ時点の最新の CSV で見る（自分の変更を当てたあとの行と取り違えないように）。
    // 同じ内容の行は数で数え、当て済みとみなすたびに1つ使う（同じ行をわざと2回足したときも、2つ目が消えないように）
    const fresh = new Map();
    for (const r of this.rows) { const k = toCSVLine(r); fresh.set(k, (fresh.get(k) || 0) + 1); }
    const has = (line) => (fresh.get(line) || 0) > 0;
    const use = (line) => fresh.set(line, fresh.get(line) - 1);
    for (const op of ops) {
      if (op.type === "delete") {
        if (this.applyOp(this.rows, op)) this.ops.push(op); else gone++;
        continue;
      }
      const after = toCSVLine(op.cells);
      if (op.type === "add" && has(after)) { use(after); continue; }
      if (op.type === "edit" && !has(op.orig) && has(after)) { use(after); continue; }
      if (this.applyOp(this.rows, op)) { this.ops.push(op); continue; }
      lost++;
      this.ops.push({ ...op, type: "add", orig: null });
    }
    return { lost, gone };
  }
  errors() { return this.parse(this.text()).errors; }
}

