// tests/transfer.test.mjs
// assets/transfer.js（ほかの端末への引き継ぎリンク）のテストです。

import test from "node:test";
import assert from "node:assert/strict";
import { encodeMarks, decodeMarks } from "../assets/transfer.js";

test("引き継ぎ：作った文字を読むと、同じ記録に戻る", async () => {
  const later = ["2026-natalie-noda", "hirose-toyokeizai-961946"], read = ["a", "b", "日本語のid"];
  const code = await encodeMarks({ later, read });
  assert.match(code, /^[zu][A-Za-z0-9_-]+$/, "URL にそのまま使える文字だけ");
  assert.deepEqual(await decodeMarks(code), { later, read });
});

test("引き継ぎ：たくさんあっても短く縮む", async () => {
  const later = Array.from({ length: 60 }, (_, i) => `2025-natalie-noda-interview-${i}`);
  const code = await encodeMarks({ later, read: [] });
  assert.ok(code.length < JSON.stringify(later).length / 2, `縮んでいない：${code.length}`);
});

test("引き継ぎ：壊れた文字は読まない（null）", async () => {
  for (const bad of ["", "x123", "zあ", "z____", "u" + btoa('{"v":2}')]) assert.equal(await decodeMarks(bad), null);
});

test("引き継ぎ：おかしな id は取り除く", async () => {
  const code = "u" + btoa(JSON.stringify({ v: 1, l: ["ok", 5, "", "x".repeat(200), "ok"], r: "no" })).replace(/=+$/, "");
  assert.deepEqual(await decodeMarks(code), { later: ["ok"], read: [] });
});
