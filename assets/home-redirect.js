// assets/home-redirect.js
// 玄関（index.html）の <head> で、いちばん先に読み込みます（モジュールではない、ふつうのスクリプト）。
// 以前はトップが記事一覧だったので、トップの住所に条件や印を付けたリンク（例：./?person=野田洋次郎、./#admin、引き継ぎ用のリンク、#later など）が、
// メンバー紹介・X の投稿・ブックマークなどに残っています。そうした住所で開かれたら、同じ条件のまま記事一覧（articles.html）へ送ります。
// 何も付いていないトップや、玄関の中の場所（#encounter など）はそのまま玄関を出します。
(function () {
  // 記事一覧の絞り込みの条件の名前（assets/app.js の F_DEFAULT と同じ）。これ以外（広告の計測の印など）では送らない
  var KEYS = ["entry", "person", "scope", "work", "year", "tour", "q", "format", "cat", "media", "lang", "kind", "status", "sort"];
  // 玄関の中の場所（index.html の id）。これ以外の # は、記事一覧の印として送る
  var OWN = ["", "#main", "#encounter", "#windows"];
  try {
    var p = new URLSearchParams(location.search);
    var hasKey = KEYS.some(function (k) { return p.has(k); });
    if (hasKey || OWN.indexOf(location.hash) < 0) location.replace("articles.html" + location.search + location.hash);
  } catch (e) { /* 古いブラウザでは何もしない（玄関がそのまま出る） */ }
})();
