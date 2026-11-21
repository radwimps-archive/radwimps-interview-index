#!/bin/sh
# tools/build.sh
# 公開するファイルを _site フォルダにまとめます。
# Cloudflare の「ビルドコマンド」（sh tools/build.sh）と、GitHub Pages の公開（.github/workflows/deploy.yml）の両方から使います。
#
# ・いちばん上の階層の .html（ページ）は、すべて公開します。ページを足しても、ここや Cloudflare を直す必要はありません。
#   公開したくない .html を置くときは、ここで外してください。
# ・assets（見た目と動き）と data（記事などのデータ）は、フォルダごと公開します。
# ・古い表示が残らないように、読み込むファイルに版の番号（?v=…）を付けます。
#   番号は、Cloudflare なら CF_PAGES_COMMIT_SHA、GitHub なら GITHUB_SHA、手元なら git のコミットから取ります。

set -eu
cd "$(dirname "$0")/.."

rm -rf _site
mkdir _site
cp -r ./*.html assets data _site/

V=$(printf '%s' "${CF_PAGES_COMMIT_SHA:-${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || date +%s)}}" | cut -c1-8)
# ページが読み込む assets の js・css（例：assets/shelf-data.js → assets/shelf-data.js?v=…）
sed -i -E "s#(assets/[a-z-]+\.(js|css))\"#\1?v=${V}\"#g" _site/*.html
# js の中で読み込むほかの js（例："./shelf-data.js" → "./shelf-data.js?v=…"）。全部に同じ番号が付くので、同じファイルが2回読み込まれることはありません
sed -i -E "s#(\"\./[a-z-]+\.js)\"#\1?v=${V}\"#g" _site/assets/*.js

echo "_site に $(ls _site/*.html | wc -l | tr -d ' ') ページをまとめました（版の番号 ${V}）"
