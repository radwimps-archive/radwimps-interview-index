#!/bin/sh
# tools/build.sh
# 公開するファイルを _site フォルダにまとめます。
# Cloudflare の「ビルドコマンド」（sh tools/build.sh）と、GitHub Pages の公開（.github/workflows/deploy.yml）の両方から使います。
#
# ・いちばん上の階層の .html（ページ）は、すべて公開します。ページを足しても、ここや Cloudflare を直す必要はありません。
#   公開しない .html は、下の「公開しないページ」で外します（closing.html は、ベータ版を閉じるときの案内ページの元で、
#   tools/closing-switch.sh が各ページに写すためのもの。それ自体は公開しない）。
# ・assets（見た目と動き）と data（記事などのデータ）は、フォルダごと公開します。
# ・古い表示が残らないように、読み込むファイルに版の番号（?v=…）を付けます。
#   番号は、Cloudflare なら CF_PAGES_COMMIT_SHA、GitHub なら GITHUB_SHA、手元なら git のコミットから取ります。
#   番号を付けられなかった読み込みが残っていたら、止めてお知らせします（assets のファイル名は、小文字の英字・数字・ハイフン・下線だけ）。
# ・Cloudflare（サイトの住所のいちばん上で公開）では、404.html の「/radwimps-interview-index/」を「/」に直します（GitHub Pages ではそのまま）。
# ・まとめる先は OUT で変えられます（テストで使います）。macOS でも動くように、sed -i は使いません。

set -eu
cd "$(dirname "$0")/.."
OUT="${OUT:-_site}"

rm -rf "$OUT"
mkdir -p "$OUT"
cp -r ./*.html assets data "$OUT/"
# 公開しないページ
rm -f "$OUT/closing.html"

V=$(printf '%s' "${CF_PAGES_COMMIT_SHA:-${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || date +%s)}}" | cut -c1-8)

# ファイルを書き換える（一時ファイルを使う。GNU と BSD〔macOS〕の sed の違いを避けるため）
edit() { f="$1"; shift; sed -E "$@" "$f" > "$f.tmp" && mv "$f.tmp" "$f"; }

for f in "$OUT"/*.html; do
  # ページが読み込む assets の js・css（例：assets/shelf-data.js → assets/shelf-data.js?v=…）
  edit "$f" "s#(assets/[a-z0-9_-]+\.(js|css))\"#\1?v=${V}\"#g"
done
for f in "$OUT"/assets/*.js; do
  # js の中で読み込むほかの js（例："./shelf-data.js" → "./shelf-data.js?v=…"）。全部に同じ番号が付くので、同じファイルが2回読み込まれることはない
  edit "$f" "s#(\"\./[a-z0-9_-]+\.js)\"#\1?v=${V}\"#g"
done
if [ -n "${CF_PAGES:-}" ] && [ -f "$OUT/404.html" ]; then
  edit "$OUT/404.html" "s#/radwimps-interview-index/#/#g"
fi

# 番号を付けられなかった読み込みが残っていないか（あれば、古い表示が残るおそれがあるので止める）
if grep -nE "\"(\./|[^\"]*assets/)[^\"?]+\.(js|css)\"" "$OUT"/*.html "$OUT"/assets/*.js; then
  echo "↑ 版の番号を付けられなかった読み込みがあります。assets のファイル名を小文字の英字・数字・ハイフン・下線だけにしてください" >&2
  exit 1
fi

echo "$OUT に $(ls "$OUT"/*.html | wc -l | tr -d ' ') ページをまとめました（版の番号 ${V}）"
