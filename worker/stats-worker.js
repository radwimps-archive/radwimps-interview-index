// worker/stats-worker.js
// 運営管理の「アクセス状況」のグラフに数字を渡す「中継役」です（Cloudflare Workers で動かします。マニュアル13-6）。
//   ・このファイルは GitHub Pages には公開されません。Cloudflare の Worker の画面に、中身をまるごと貼り付けて使います。
//   ・Cloudflare の合鍵（API トークン）は、Worker の「シークレット」にだけ入れます。サイトやこのファイルには書きません。
//   ・運営管理で入れた「合言葉」が、Worker のシークレット ADMIN_KEY と同じときだけ数字を返します。
//
// Worker に登録するもの（設定 → 変数とシークレット）
//   CF_API_TOKEN（シークレット）：Cloudflare の合鍵。許可は「アカウント → Account Analytics → 読み取り」だけ。
//   ADMIN_KEY   （シークレット）：運営管理で入れる合言葉（12文字以上）。
//   ACCOUNT_ID  （なくてもよい） ：Cloudflare のアカウント ID。空なら合鍵から自動で見つけます。

const SITE_HOST = "radwimps-archive.github.io";        // 数えるサイト
const ALLOWED_ORIGINS = ["https://radwimps-archive.github.io"]; // 数字を渡してよいサイト
const API = "https://api.cloudflare.com/client/v4";
const JST = 9 * 3600 * 1000; // 日本時間（日の区切りに使う）

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "X-Admin-Key",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };
    const reply = (status, body) => new Response(JSON.stringify(body), {
      status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") return reply(405, { error: "method" });
    if (!env.ADMIN_KEY || String(env.ADMIN_KEY).length < 12) return reply(500, { error: "no-admin-key" });
    if (!env.CF_API_TOKEN) return reply(500, { error: "no-api-token" });
    if (!sameText(request.headers.get("X-Admin-Key") || "", String(env.ADMIN_KEY))) return reply(401, { error: "bad-key" });

    const days = new URL(request.url).searchParams.get("days") === "30" ? 30 : 7;
    try {
      return reply(200, await getStats(env, days));
    } catch (e) {
      return reply(502, { error: e.code || "api", detail: String(e.message || e).slice(0, 300) });
    }
  }
};

// 合言葉を比べる（文字数や中身で、比べる時間が変わりにくいように）
function sameText(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

function fail(code, message) { const e = new Error(message); e.code = code; return e; }

async function cf(env, path, init) {
  const res = await fetch(API + path, {
    ...init,
    headers: { "Authorization": `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "application/json" }
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) throw fail("token", JSON.stringify(json.errors || json).slice(0, 300));
  if (!res.ok) throw fail("api", `${res.status} ${JSON.stringify(json.errors || json).slice(0, 300)}`);
  return json;
}

async function accountId(env) {
  if (env.ACCOUNT_ID) return String(env.ACCOUNT_ID).trim();
  const json = await cf(env, "/accounts?per_page=5");
  const id = json.result && json.result[0] && json.result[0].id;
  if (!id) throw fail("account", "アカウントが見つかりません");
  return id;
}

// 問い合わせの文。filter は中身が決まった値（サイト名・日時）だけなので、そのまま文に埋め込みます
function query(acc, f, timeKey) {
  const filter = `{ requestHost: ${JSON.stringify(f.host)}, datetime_geq: ${JSON.stringify(f.from)}, datetime_leq: ${JSON.stringify(f.to)} }`;
  const g = (name, limit, order, fields) => `${name}: rumPageloadEventsAdaptiveGroups(limit: ${limit}, filter: ${filter}${order ? `, orderBy: [${order}]` : ""}) { ${fields} }`;
  return `query { viewer { accounts(filter: { accountTag: ${JSON.stringify(acc)} }) {
    ${g("total", 1, "", "count sum { visits }")}
    ${g("timeline", 1000, `${timeKey}_ASC`, `count sum { visits } dimensions { ${timeKey} }`)}
    ${g("pages", 10, "count_DESC", "count dimensions { requestPath }")}
    ${g("referrers", 10, "count_DESC", "count dimensions { refererHost }")}
    ${g("devices", 5, "count_DESC", "count dimensions { deviceType }")}
    ${g("countries", 8, "count_DESC", "count dimensions { countryName }")}
  } } }`;
}

async function ask(env, acc, f, timeKey) {
  const json = await cf(env, "/graphql", { method: "POST", body: JSON.stringify({ query: query(acc, f, timeKey) }) });
  if (json.errors && json.errors.length) {
    const msg = json.errors.map((e) => e.message).join(" / ");
    throw fail(/authz|permission|not authorized|access/i.test(msg) ? "token" : "api", msg);
  }
  const a = json.data && json.data.viewer && json.data.viewer.accounts && json.data.viewer.accounts[0];
  if (!a) throw fail("account", "アカウントの数字を読めませんでした");
  return a;
}

async function getStats(env, days) {
  const now = Date.now();
  // 日本時間の「今日の0時」から days-1 日前の0時まで
  const todayJst = Math.floor((now + JST) / 86400000) * 86400000;
  const start = todayJst - (days - 1) * 86400000 - JST;
  const f = { host: SITE_HOST, from: new Date(start).toISOString(), to: new Date(now).toISOString() };
  const acc = await accountId(env);
  // ふつうは1時間ごとの数字を日本時間の日にまとめます。1時間ごとが使えないときは、日ごと（世界標準時の日付）にします
  let a, hourly = true;
  try { a = await ask(env, acc, f, "datetimeHour"); }
  catch (e) { if (e.code !== "api") throw e; a = await ask(env, acc, f, "date"); hourly = false; }

  const daily = [];
  for (let i = 0; i < days; i++) daily.push({ date: new Date(start + JST + i * 86400000).toISOString().slice(0, 10), views: 0, visits: 0 });
  for (const g of a.timeline || []) {
    const i = hourly ? Math.floor((Date.parse(g.dimensions.datetimeHour) - start) / 86400000)
      : daily.findIndex((d) => d.date === g.dimensions.date);
    if (i >= 0 && i < days) { daily[i].views += g.count || 0; daily[i].visits += (g.sum && g.sum.visits) || 0; }
  }
  const list = (rows, key) => (rows || []).map((g) => ({ name: g.dimensions[key] || "", views: g.count || 0 }));
  const t = (a.total && a.total[0]) || { count: 0, sum: { visits: 0 } };
  return {
    host: SITE_HOST, days, from: daily[0].date, to: daily[days - 1].date, updated: new Date(now).toISOString(),
    total: { views: t.count || 0, visits: (t.sum && t.sum.visits) || 0 },
    daily,
    pages: list(a.pages, "requestPath"),
    referrers: list(a.referrers, "refererHost"),
    devices: list(a.devices, "deviceType"),
    countries: list(a.countries, "countryName")
  };
}
