#!/bin/sh
# tools/closing-switch.sh
# ベータ版の公開を終えるときに使います（11/30）。
# 準備中の案内ページ（closing.html）を、各ページ（index.html・history.html・members.html・setlist.html・404.html）に写します。
# maker.html（記事データ作成ツール）と、assets・data のファイルはそのまま残します。保存データ（ブラウザの中）には触れません。
# 使い方：リポジトリのいちばん上のフォルダで  sh tools/closing-switch.sh  を実行し、コミットして main に入れます。
set -e
cd "$(dirname "$0")/.."
# 切り替える前に、ベータ版の最後の状態に目印（タグ）を付けておくと、戻すときに使えます：
#   git tag beta-final && git push origin beta-final
# 戻すとき：git checkout beta-final -- index.html history.html members.html setlist.html 404.html
for f in index.html history.html members.html setlist.html; do
  cp closing.html "$f"
  echo "写しました：$f"
done
# 404.html は、存在しない深い住所（例：/radwimps-interview-index/foo/bar）でも同じ中身で返されるので、
# assets の場所を「/radwimps-interview-index/assets/」からの書き方に変え、検索に載せない印（noindex）を付ける
sed -e 's#\(href\|src\)="assets/#\1="/radwimps-interview-index/assets/#g' \
    -e 's#<meta name="theme-color"#<meta name="robots" content="noindex">\
<meta name="theme-color"#' closing.html > 404.html
echo "写しました：404.html（assets の場所を書き換え）"
echo "closing.html や config.js を直したときは、このスクリプトをもう一度実行してから、コミットしてください。"
