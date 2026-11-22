// assets/github.js
// 運営管理から GitHub のデータ（data フォルダの CSV）を読み書きするための道具です。
// 記事の管理（admin.js）と、「RADWIMPSの歩み」の年表の管理（admin-history.js）で同じものを使います。
//   ・GitHub への書き込みには、管理者が GitHub で作った「合鍵」（アクセストークン）を使います。
//   ・合鍵はこの端末のブラウザにだけ保存し、GitHub（api.github.com）以外には送りません。
//   ・合鍵の保存場所（STORE_TOKEN・STORE_REPO）は、記事の管理と年表の管理で同じです（一度登録すれば、どちらでも使えます）。

export const STORE_TOKEN = "radwimps-interview-index:gh-token";
export const STORE_REPO = "radwimps-interview-index:gh-repo";
const API = "https://api.github.com";

const nf = (s) => String(s ?? "").normalize("NFKC").trim();
export const lsGet = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
export const lsSet = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* 保存できない環境 */ } };

export function decodeBase64Utf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes); // 先頭の BOM も文字として残す
}
export function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
// 「owner/repo」や「https://github.com/owner/repo」から「owner/repo」を取り出す
export function repoName(s) {
  const m = nf(s).replace(/\.git$/, "").match(/^(?:https?:\/\/github\.com\/)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/?$/);
  return m ? `${m[1]}/${m[2]}` : "";
}

export class GhError extends Error {}

// GitHub とのやりとり。token・repo を渡して作り、init() でつなぐ
export class GitHub {
  constructor(token, repo) { this.token = token; this.repo = repo; this.branch = ""; this.committer = null; }

  async req(path, init = {}) {
    try {
      return await fetch(API + path, {
        ...init, cache: "no-store",
        headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", Authorization: "Bearer " + this.token, ...(init.headers || {}) }
      });
    } catch {
      throw new GhError("GitHub につながりませんでした。通信の状態を確かめてください（claude.ai のプレビューでは GitHub につなげません。公開したサイトで使えます）。");
    }
  }
  // うまくいかなかったときの GhError。keyProblem：合鍵そのものの問題（登録し直してもらう）
  async fail(res, what) {
    let msg = "";
    try { msg = (await res.json()).message || ""; } catch { /* 本文なし */ }
    const err = (m, keyProblem = false) => Object.assign(new GhError(m), { keyProblem });
    if (res.status === 401) return err("合鍵（アクセストークン）が正しくないか、期限が切れています。新しい合鍵を作って、登録し直してください。", true);
    if (res.status === 403 && /rate limit/i.test(msg)) return err("GitHub の利用回数の上限に達しました。しばらく待ってから、もう一度試してください。");
    if (res.status === 403) return err("この合鍵には、データを書き換える許可がありません。「Contents」を「Read and write」にした合鍵を作って、登録し直してください。", true);
    if (res.status === 404) return err(`${what}が見つかりません。リポジトリ名（${this.repo}）と、合鍵を作るときに選んだリポジトリが合っているか確かめてください。`);
    return err(`GitHub でエラーが起きました（${res.status}${msg ? "：" + msg : ""}）。`);
  }
  // リポジトリの確認と、保存先のブランチ・保存したときの記録に出す名前を調べる
  async init() {
    const res = await this.req(`/repos/${this.repo}`);
    if (!res.ok) throw await this.fail(res, "リポジトリ");
    this.branch = (await res.json()).default_branch || "main";
    // 保存したときの記録（コミット）に、個人のメールアドレスが出ないようにする：GitHub の「noreply」のアドレスを使う
    // （リポジトリは誰でも見られるので。取れないときは、GitHub の設定のままで保存します）
    this.committer = null;
    try {
      const u = await this.req("/user");
      if (u.ok) {
        const me = await u.json();
        if (me.login && me.id) this.committer = { name: me.login, email: `${me.id}+${me.login}@users.noreply.github.com` };
      }
    } catch { /* 取れなくても保存はできる */ }
  }
  // ファイルを読む。戻り値：{ text, sha }（sha は保存のときに使う、今のファイルの目印）
  async read(file, what) {
    const path = `/repos/${this.repo}/contents/${file}?ref=${encodeURIComponent(this.branch)}`;
    const res = await this.req(path);
    if (!res.ok) throw await this.fail(res, what);
    const j = await res.json();
    let text = j.content ? decodeBase64Utf8(j.content) : "";
    if (!j.content) { // 1MB を超えるファイルは、別の形で受け取る
      const raw = await this.req(path, { headers: { Accept: "application/vnd.github.raw+json" } });
      if (!raw.ok) throw await this.fail(raw, what);
      text = await raw.text();
    }
    return { text, sha: j.sha };
  }
  // ファイルを書き換える。GitHub 側が先に変わっていたときは、409 か 422 の Response がそのまま返る（呼んだ側で重ね直す）
  write(file, text, sha, message) {
    return this.req(`/repos/${this.repo}/contents/${file}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, content: encodeBase64Utf8(text), sha, branch: this.branch, ...(this.committer ? { committer: this.committer, author: this.committer } : {}) })
    });
  }
}
