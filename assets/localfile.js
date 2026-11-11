// assets/localfile.js
// パソコンで index.html を直接開いたときの案内です（ブラウザの制限で、このときは記事を表示できません）。
// ※ module ではない、ふつうのスクリプトとして読み込みます（module は、ファイルを直接開いたときに動かないため）。
if (location.protocol === "file:") {
  const loading = document.getElementById("loading");
  if (loading) loading.textContent = "このファイルをパソコンで直接開いても、記事は表示されません。公開したサイトの URL で開くか、運用マニュアルの「付録D」の方法で確かめてください。";
}
