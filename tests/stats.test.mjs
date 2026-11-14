// tests/stats.test.mjs
// 運営管理の「アクセス状況」（assets/stats.js）と中継役（worker/stats-worker.js）を確かめます（node --test で動きます）。
// 中継役の確認では、Cloudflare には実際にはつながず、返ってくる答えの形をまねして試します。

import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanWorkerUrl, pageName, refName, niceMax, countryName } from "../assets/stats.js";
import worker from "../worker/stats-worker.js";

test("中継役の URL は https の workers.dev だけ受け付ける", () => {
  assert.equal(cleanWorkerUrl(" https://radwimps-stats.tama.workers.dev/ "), "https://radwimps-stats.tama.workers.dev");
  assert.equal(cleanWorkerUrl("http://radwimps-stats.tama.workers.dev"), "");
  assert.equal(cleanWorkerUrl("https://example.com"), "");
  assert.equal(cleanWorkerUrl("https://workers.dev.example.com"), "");
  assert.equal(cleanWorkerUrl("ふつうの文字"), "");
});

test("ページ名・来た場所の名前", () => {
  assert.equal(pageName("/"), "記事一覧（トップ）");
  assert.equal(pageName("/history.html"), "RADWIMPSの歩み（年表）");
  assert.equal(pageName("/other.html"), "/other.html");
  assert.equal(refName(""), "直接・ブックマークなど");
  assert.equal(refName("www.google.co.jp"), "Google 検索");
  assert.equal(refName("t.co"), "X（旧Twitter）");
  assert.equal(refName("search.yahoo.co.jp"), "Yahoo! 検索");
  assert.equal(refName("example.org"), "example.org");
  assert.equal(countryName("JP"), "日本");
  assert.equal(countryName(""), "不明");
});

test("グラフの目盛りの上限は、きりのいい数", () => {
  assert.equal(niceMax(0), 4);
  assert.equal(niceMax(7), 8);
  assert.equal(niceMax(13), 15);
  assert.equal(niceMax(42), 50);
  assert.equal(niceMax(230), 250);
  assert.equal(niceMax(1000), 1000);
});

const KEY = "himitsu-no-aikotoba";
const ENV = { ADMIN_KEY: KEY, CF_API_TOKEN: "dummy" };
const req = (days, key = KEY, method = "GET") => new Request(`https://x.workers.dev/?days=${days}`,
  { method, headers: { Origin: "https://radwimps-archive.github.io", ...(key ? { "X-Admin-Key": key } : {}) } });

function fakeCloudflare(handler) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return handler(String(url), init, calls); };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("中継役：合言葉が違うと数字を返さない（Cloudflare にも問い合わせない）", async () => {
  const cf = fakeCloudflare(() => json({}));
  try {
    assert.equal((await worker.fetch(req(7, "chigau-aikotoba-desu"), ENV)).status, 401);
    assert.equal((await worker.fetch(req(7, ""), ENV)).status, 401);
    assert.equal((await worker.fetch(req(7), { ...ENV, ADMIN_KEY: "short" })).status, 500);
    const pre = await worker.fetch(req(7, "", "OPTIONS"), ENV);
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("Access-Control-Allow-Origin"), "https://radwimps-archive.github.io");
    assert.equal(cf.calls.length, 0);
  } finally { cf.restore(); }
});

test("中継役：1時間ごとの数字を日本時間の日ごとにまとめて返す", async () => {
  const now = Date.now();
  const JST = 9 * 3600 * 1000;
  const todayJst = Math.floor((now + JST) / 86400000) * 86400000; // 日本時間の今日0時（を世界標準時の数で）
  const startUtc = todayJst - 6 * 86400000 - JST;
  const hour = (dayIndex, h) => new Date(startUtc + dayIndex * 86400000 + h * 3600000).toISOString();
  const cf = fakeCloudflare((url, init) => {
    if (url.endsWith("/accounts?per_page=5")) return json({ result: [{ id: "acc123" }] });
    const q = JSON.parse(init.body).query;
    assert.match(q, /accountTag: "acc123"/);
    assert.match(q, /requestHost: "radwimps-archive\.github\.io"/);
    return json({ data: { viewer: { accounts: [{
      total: [{ count: 30, sum: { visits: 12 } }],
      timeline: [
        { count: 5, sum: { visits: 2 }, dimensions: { datetimeHour: hour(0, 0) } },  // 1日目の0時（日本時間）
        { count: 4, sum: { visits: 3 }, dimensions: { datetimeHour: hour(0, 23) } }, // 1日目の23時
        { count: 21, sum: { visits: 7 }, dimensions: { datetimeHour: hour(6, 1) } }  // 7日目（今日）
      ],
      pages: [{ count: 20, dimensions: { requestPath: "/" } }],
      referrers: [{ count: 9, dimensions: { refererHost: "t.co" } }],
      devices: [{ count: 25, dimensions: { deviceType: "mobile" } }],
      countries: [{ count: 30, dimensions: { countryName: "JP" } }]
    }] } } });
  });
  try {
    const res = await worker.fetch(req(7), ENV);
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.equal(d.daily.length, 7);
    assert.deepEqual(d.daily.map((x) => x.visits), [5, 0, 0, 0, 0, 0, 7]);
    assert.deepEqual(d.daily.map((x) => x.views), [9, 0, 0, 0, 0, 0, 21]);
    assert.equal(d.to, new Date(todayJst).toISOString().slice(0, 10));
    assert.deepEqual(d.total, { views: 30, visits: 12 });
    assert.deepEqual(d.pages, [{ name: "/", views: 20 }]);
    assert.equal(cf.calls[1].init.headers.Authorization, "Bearer dummy");
  } finally { cf.restore(); }
});

test("中継役：Cloudflare の合鍵が使えないときは token と返す", async () => {
  const cf = fakeCloudflare(() => json({ success: false, errors: [{ message: "Authentication error" }] }, 403));
  try {
    const res = await worker.fetch(req(30), { ...ENV, ACCOUNT_ID: "acc123" });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, "token");
  } finally { cf.restore(); }
});
