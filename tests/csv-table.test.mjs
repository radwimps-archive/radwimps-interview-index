// tests/csv-table.test.mjs
// 年表の管理（admin-history.js）の「まだ保存していない変更」の記録（assets/csv-table.js）を確かめます（node --test で動きます）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Table } from "../assets/csv-table.js";
import { parseHistory, parseSites, parseCSV, toCSVLine } from "../assets/data.js";

const HEAD = "年,月,日,終了年,終了月,終了日,カテゴリ,出来事,補足,特設サイト,タワーレコード,動画";
const csv = (...rows) => "﻿" + [HEAD, ...rows].join("\n") + "\n";
const make = (text, newestFirst = false) => { const t = new Table({ file: "f", what: "w", label: "出来事", parse: parseHistory, newestFirst }); t.load(text); return t; };
const row = (y, m, d, title) => [String(y), String(m), String(d), "", "", "", "リリース", title, "", "", "", ""];

test("読み込んだまま書き出しても、中身は変わらない（BOM・改行も。いらない引用符は外れることがある）", () => {
  const text = readFileSync(new URL("../data/history.csv", import.meta.url), "utf8");
  assert.equal(make(text).text(), text);
  const sites = readFileSync(new URL("../data/sites.csv", import.meta.url), "utf8");
  const t = new Table({ file: "f", what: "w", label: "特設サイト", parse: parseSites, newestFirst: true }); t.load(sites);
  assert.equal(t.text().charCodeAt(0), sites.charCodeAt(0));
  assert.deepEqual(parseCSV(t.text()).rows, parseCSV(sites).rows);
  assert.deepEqual(parseSites(t.text()).sites.map((x) => x.id), parseSites(sites).sites.map((x) => x.id));
});

test("追加は日付の順の位置に入る（年表は古い順・同じ日付なら最後に）", () => {
  const t = make(csv("2010,1,1,,,,リリース,A,,,,", "2012,5,1,,,,リリース,C,,,,"));
  t.doOp({ type: "add", orig: null, cells: row(2011, 3, 3, "B") });
  t.doOp({ type: "add", orig: null, cells: row(2012, 5, 1, "D") });
  assert.deepEqual(t.rows.map((r) => r[7]), ["A", "B", "C", "D"]);
  assert.deepEqual(t.counts(), { add: 2, edit: 0, delete: 0, total: 2 });
});

test("特設サイトは新しい順の位置に入る", () => {
  const t = make(csv("2012,5,1,,,,リリース,C,,,,", "2010,1,1,,,,リリース,A,,,,"), true);
  t.doOp({ type: "add", orig: null, cells: row(2011, 3, 3, "B") });
  assert.deepEqual(t.rows.map((r) => r[7]), ["C", "B", "A"]);
});

test("同じ行を何度も直しても、変更は1件。追加した行を消すと、変更は0件", () => {
  const t = make(csv("2010,1,1,,,,リリース,A,,,,"));
  const a = t.rows[0];
  const a2 = a.slice(); a2[8] = "補足1";
  t.doOp({ type: "edit", orig: toCSVLine(a), cells: a2 });
  const a3 = a2.slice(); a3[8] = "補足2";
  t.doOp({ type: "edit", orig: toCSVLine(a2), cells: a3 });
  assert.deepEqual(t.counts(), { add: 0, edit: 1, delete: 0, total: 1 });
  t.doOp({ type: "delete", orig: toCSVLine(a3), cells: null });
  assert.deepEqual(t.counts(), { add: 0, edit: 0, delete: 1, total: 1 });
  assert.equal(t.rows.length, 0);
  const b = row(2011, 1, 1, "B");
  t.doOp({ type: "add", orig: null, cells: b });
  t.doOp({ type: "delete", orig: toCSVLine(b), cells: null });
  assert.deepEqual(t.counts(), { add: 0, edit: 0, delete: 1, total: 1 });
});

test("GitHub 側が先に変わっていたら、最新に重ねる。同じ行が先に直されていたら、直した内容を追加の行として残し、件数を返す", () => {
  const t = make(csv("2010,1,1,,,,リリース,A,,,,", "2011,1,1,,,,リリース,B,,,,"));
  const [a, b] = t.rows;
  const a2 = a.slice(); a2[8] = "こちらで直した";
  t.doOp({ type: "edit", orig: toCSVLine(a), cells: a2 });
  t.doOp({ type: "delete", orig: toCSVLine(b), cells: null });
  t.doOp({ type: "add", orig: null, cells: row(2012, 1, 1, "C") });
  // 別の場所で、新しい行が足された（重ならない変更）
  assert.equal(t.reload(csv("2010,1,1,,,,リリース,A,,,,", "2011,1,1,,,,リリース,B,,,,", "2013,1,1,,,,リリース,X,,,,")), 0);
  assert.deepEqual(t.rows.map((r) => r[7] + r[8]), ["Aこちらで直した", "C", "X"]);
  // 別の場所で、同じ行（A）が先に直された
  const t2 = make(csv("2010,1,1,,,,リリース,A,,,,"));
  const x = t2.rows[0], x2 = x.slice(); x2[8] = "こちら";
  t2.doOp({ type: "edit", orig: toCSVLine(x), cells: x2 });
  assert.equal(t2.reload(csv("2010,1,1,,,,リリース,A,あちら,,,")), 1);
  assert.deepEqual(t2.rows.map((r) => r[8]), ["あちら", "こちら"]);
  assert.deepEqual(t2.counts(), { add: 1, edit: 0, delete: 0, total: 1 }); // 次は追加として保存される
});

test("CSV の行番号から、何番目の行かがわかる（引用符の中の改行があっても）", () => {
  const t = make(csv("2010,1,1,,,,リリース,A,\"2行の\n補足\",,,", "2011,1,1,,,,リリース,B,,,,"));
  const b = parseHistory(t.text()).events.find((e) => e.title === "B");
  assert.equal(t.indexOfLine(b.line), 1);
  assert.equal(t.indexOfLine(999), -1);
});

test("取り消すと、読み込んだときの状態に戻る", () => {
  const t = make(csv("2010,1,1,,,,リリース,A,,,,"));
  t.doOp({ type: "add", orig: null, cells: row(2011, 1, 1, "B") });
  t.reset();
  assert.equal(t.rows.length, 1);
  assert.equal(t.counts().total, 0);
});

test("前の保存が済んでいたのに返事が届かなかったとき：重ね直しても行は増えず、変更は当て済みになる", () => {
  const t = make(csv("2010,1,1,,,,リリース,A,,,,"));
  const a = t.rows[0], a2 = a.slice(); a2[8] = "直した";
  t.doOp({ type: "edit", orig: toCSVLine(a), cells: a2 });
  t.doOp({ type: "add", orig: null, cells: row(2011, 1, 1, "B") });
  const already = t.text(); // GitHub 側には、もう保存されていた
  assert.equal(t.reload(already), 0);
  assert.equal(t.rows.length, 2);
  assert.equal(t.counts().total, 0);
});

test("両方で同じ行を消していたときは、取りこぼしに数えない", () => {
  const t = make(csv("2010,1,1,,,,リリース,A,,,,", "2011,1,1,,,,リリース,B,,,,"));
  t.doOp({ type: "delete", orig: toCSVLine(t.rows[0]), cells: null });
  assert.equal(t.reload(csv("2011,1,1,,,,リリース,B,,,,")), 0);
  assert.equal(t.counts().total, 0);
  assert.deepEqual(t.rows.map((r) => r[7]), ["B"]);
});

test("中身の変わらない「直す」は記録しない。直してもとに戻したら、変更はなくなる", () => {
  const t = make(csv("2010,1,1,,,,リリース,A,,,,"));
  const a = t.rows[0];
  assert.equal(t.doOp({ type: "edit", orig: toCSVLine(a), cells: a.slice() }), false);
  const a2 = a.slice(); a2[8] = "x";
  t.doOp({ type: "edit", orig: toCSVLine(a), cells: a2 });
  t.doOp({ type: "edit", orig: toCSVLine(a2), cells: a.slice() });
  assert.equal(t.counts().total, 0);
});

test("日付を直すと、CSV の中でも日付の順の位置へ動く", () => {
  const t = make(csv("2010,1,1,,,,リリース,A,,,,", "2011,1,1,,,,リリース,B,,,,", "2012,1,1,,,,リリース,C,,,,"));
  const a = t.rows[0], a2 = a.slice(); a2[0] = "2011"; a2[1] = "6";
  t.doOp({ type: "edit", orig: toCSVLine(a), cells: a2 });
  assert.deepEqual(t.rows.map((r) => r[7]), ["B", "A", "C"]);
});

test("空行や引用符の中の改行がある CSV でも、書き出し直した中身の行番号と、行がそろう（「保存せずに試す」は、この中身で年表を作り直す）", () => {
  const t = make(csv("2010,1,1,,,,リリース,A,,,,", "", "2011,1,1,,,,リリース,B,\"2行の\n補足\",,,", "", "2012,1,1,,,,リリース,C,,,,"));
  for (const e of parseHistory(t.text()).events) assert.equal(t.rows[t.indexOfLine(e.line)][7], e.title);
});

test("同じ内容の行が2つあるとき、どちらを直しても、1つだけが直る（行の数は変わらない）", () => {
  const t = make(csv("2010,1,1,,,,リリース,A,,,,", "2010,1,1,,,,リリース,A,,,,"));
  const a2 = t.rows[1].slice(); a2[8] = "直した";
  t.doOp({ type: "edit", orig: toCSVLine(t.rows[1]), cells: a2 });
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows.filter((r) => r[8] === "直した").length, 1);
});
