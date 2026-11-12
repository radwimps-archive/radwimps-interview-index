// assets/analytics.js
// アクセス数の集計（Cloudflare Web Analytics）。config.js の analytics.cloudflare に「トークン」を書いたときだけ動きます。
//   ・Cookie を使わず、名前やメールアドレスなどの個人情報も集めません（どのページが何回見られたか・おおよその国・端末の種類など）。
//   ・運営者の端末（管理者モードをオンにした端末）からのアクセスは数えません。
//   ・数字は Cloudflare の画面で見ます（運営管理の「アクセス状況」にリンクがあります。マニュアル13-5）。
// ※ 読み込み先を変えたら、各ページの CSP（script-src・connect-src）も同じに直してください。

import config from "./config.js";
import { isAdminDevice } from "./ui.js";

const TOKEN = /^[0-9a-f]{32}$/i.test((config.analytics && config.analytics.cloudflare) || "") ? config.analytics.cloudflare : "";
export const analyticsOn = !!TOKEN;
export const DASHBOARD_URL = "https://dash.cloudflare.com/?to=/:account/web-analytics";

if (TOKEN && !isAdminDevice()) {
  const s = document.createElement("script");
  s.defer = true;
  s.src = "https://static.cloudflareinsights.com/beacon.min.js";
  s.setAttribute("data-cf-beacon", JSON.stringify({ token: TOKEN, spa: false }));
  document.head.append(s);
}
