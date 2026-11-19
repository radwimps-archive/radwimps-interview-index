#!/bin/sh
# tools/closing-switch.sh
# ベータ版の公開を終えるときに使います（11/30）。
# 準備中の案内ページ（closing.html）を、各ページ（index.html・history.html・members.html・setlist.html・404.html）に写します。
# maker.html（記事データ作成ツール）と、assets・data のファイルはそのまま残します。保存データ（ブラウザの中）には触れません。
# 使い方：リポジトリのいちばん上のフォルダで  sh tools/closing-switch.sh  を実行し、コミットして main に入れます。
set -e
cd "$(dirname "$0")/.."
for f in index.html history.html members.html setlist.html 404.html; do
  cp closing.html "$f"
  echo "写しました：$f"
done
