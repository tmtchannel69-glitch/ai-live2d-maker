# パーツから作るキャラクター生成モード

2026-10-24。オーナーが新モードの構成整理と、その後の最小実装を承認。基準c297aeb、`feature/part-first-character-generation`。既存の画像1枚→Inochi2D変換、編集/保存版1〜12、詳細CLIを維持する。

## 最初の範囲と画面

正面/胸上/アニメ調の女の子1人/メイド服/両目が見える/通常顔。制作モードを「画像1枚から変換」「パーツからキャラ生成」で切り替える。既存のDOM/状態を保持し、新モードは専用の設定/プレビュー/パーツ確認/保存を持つ。スマホ縦画面、48px以上のボタン、16px以上の入力を基準にする。

最初は配置確認用の図形、その後は端末内のテンプレート描画を接続する。顔/目/髪/衣服を初めから別々の透明PNGへ描き、完成画像を切り分けない。髪色/瞳色/背景の選択を同じ配置へ適用する。これはAI自由生成ではなく、画面/保存データでも区別する。外部API、料金、画像送信は追加しない。将来の生成providerは同じパーツ契約へ差し替える。

## 保存形式

新形式`ai-live2d-generated-character`版1を使用し、既存の作業ZIPとは分ける。ZIPには次を入れる。

- `preview.png`：通常顔の完成画像。透明または単色背景。
- `parts/<role>.png`：指定33役割の独立した透明RGBA PNG。耳/肌/髪/虹彩などの隠れる部分もテンプレートで描く。
- `character_manifest.json`：キャンバス、生成方式/版/再生成設定、役割、PNGの位置とサイズ、重なり順、支点、親、初期表示、クリップ先。左右は本人基準（lは画面右）。
- `rig_metadata.json`：共通の親子/支点と静止状態のmesh。動作キー/物理の完成とは区別する。
- `inochi_intermediate.json`：公式0.8.6を対象とするNode/Partの候補、支点からの相対配置、UV/三角形、マスク参照。画像の格納/透明度変換/実INP出力/公式動作は未検証と明記する。
- `generation_recipe.json`と説明：同じテンプレート設定で再生成するための方式/版/色/背景。

座標は768×1024の左上基準ピクセル。PNGは矩形内に切り詰めた独立ファイルで、rectは整数。anchorは同じキャンバス上の絶対座標。parentは定義したグループを参照し、グループも同じ座標系の支点を持つ。初期表示はorderの小さい順に合成。口内は存在するPNGだが通常顔では非表示。虹彩/ハイライトは白目のalphaで合成時だけクリップし、元PNGは完全な形を保持する。

既存の観測部品形式は「元画素の所有が一意」を前提にするため、重なる新パーツをそのまま渡さない。独立した中間変換で原点/順序/支点/マスクを解決する。Inochi2DとCubism/VTube Studioの互換は別で、MVPを完成した動くモデルと表示しない。

## 追加ファイルと順序

1. `shared/generated-character.js`とschema：33役割、座標/参照/親子の検証、rig/中間データ。
2. `src/character-generation/template.js`：固定配置と独立した図形/メイド服の描画。
3. `generator.js`：生成provider、PNG生成、進捗、中止、失敗時の破棄、完成合成。
4. `archive.js`：既存fflateを再利用したPNG/JSON/設定のZIP。
5. `panel.js`/`style.css`：独立画面。`src/main.js`にはモードの接続のみ追加。既存の`workflow-navigation.js`には、非表示中の工程をスクロールで切り替えないガードを追加。
6. `tests/character-generation.spec.js`と独立データのテスト：実PNG/ZIPの再構成、左右/alpha/clip/順序、中止/失敗/再生成、既存機能の保持、スマホ寸法。

生成画像/モデル/ZIPはGit外。ソース/設定/生成手順/検証を開発ブランチへコミット・プッシュする。main統合/公開/新課金/外部画像送信は行わない。

## 使い方

アプリ上部の「パーツから生成」を選び、色/背景/作り方を選択して「パーツを生成して組み立てる」を押す。生成完了後に完成画像へ移動する。パーツの選択欄では33役割を単体確認/PNG保存できる。「パーツと設定をZIP保存」で一式を保存する。

入力を変更しても生成済みの画像/ダウンロードは前回の結果を保持し、作り直しが成功したときだけ入れ替える。処理中止/空の画像/サイズ違い/PNG失敗でも前回の結果を保持する。図形方式は配置確認用と表示し、テンプレート描画/AI生成と混同しない。

この版のproviderは`local-template-v1`だけを登録し、各パーツのPNGを生成する入口を分離した。外部providerをテンプレート/AI未使用と偽って保存しないよう、未知の方式は拒否する。AI接続時は生成元/版/費用/データ送信/整合性の仕様を別に追加する。

## PC/クラウドで再生成する

Node 20.19以上または22.12以上と対応ブラウザを使用。新モードの描画はJavaScriptで行う。

```sh
git clone --branch feature/part-first-character-generation https://github.com/tmtchannel69-glitch/ai-live2d-maker.git
cd ai-live2d-maker
npm ci
npm run dev
```

ブラウザで上記の操作を行う。CLIではPlaywright Chromiumを準備し、別ターミナルで次を実行する。開発サーバーは同じPC上で起動しておく。保存先の親フォルダは既存のものを使い、出力フォルダ自体は新規かつリポジトリ外にする。

```sh
npx playwright install chromium
node scripts/character-generation/export.mjs --output /tmp/NEW-generated-character
# ZIPから取り出した設定で再生成
node scripts/character-generation/export.mjs --recipe /path/to/generation_recipe.json --output /tmp/NEW-generated-character-replay
```

Windowsでは`--output 'C:\Users\YOUR_NAME\Documents\NEW-generated-character'`など自分の保存先へ置き換える。Windows/iPhone実機は未検証。クラウドで既存Chromiumを使う場合は`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`をコマンドの前に指定する。

CLIはPNG/JSONを展開したフォルダとZIP、入力設定/ブラウザ/コード版/未コミット変更の有無/ソース指紋を含む`generation_report.json`を出力する。既存フォルダの上書きとGit内への出力は拒否する。生成画像の外部アップロードは行わず、接続先もローカルの開発サーバーに限定する。Linux Chromiumでの同じ設定の再実行を検証し、異なるブラウザでの全バイト一致は保証しない。

## Inochi2Dとの接続範囲

中間データの33Partは、支点を基準とした9頂点/8三角形、PNG参照、UV、親グループ、元画像中心からの相対変換、白目マスクを持つ。前面のorderが大きい保存形式を、SDK候補の負のzsortへ変換する。親をたどったworld座標が元PNGの配置へ戻ることを自動検査する。

これは静止状態の接続データであり、INP/INXファイルは出力していない。旧版用の格納時透明度変換、まばたき/顔/髪のキー、物理、公式Creatorでの実読み込みは次の段階。既存の5役割生成器へ新パーツを押し込む変換や、旧APIの切り替えはしない。Cubism/VTube Studio対応と表示しない。

## 検証と限界

今回の合否/件数/実物の指紋/残課題は[検証結果](PART_FIRST_CHARACTER_VALIDATION.md)に記録する。

- すべてのPNGの実RGBA/サイズ/可視画素、本人左右、顔の肌が目の下にも存在すること、口内の非表示、マスク参照を検査。
- ダウンロードした33PNG/JSONを別の合成処理で組み立て、完成PNGとの画素一致を確認。
- モードの往復で旧元画像/作業ZIPが保持されること、外部API要求0、背景変更時にパーツPNGが変わらないこと、中止/失敗/再試行、図形モードの明示を確認。
- 320/390/844/1280px幅で横はみ出しなし、主な操作48px以上/入力16px以上を確認。これはChromeの画面寸法試験で、iPhone/Safari実機の合格ではない。
- テンプレートの通常顔を静止表示するMVP。完成した自由生成AI、自然な動作、ネイティブアプリ、モデル互換、任意素材の自動認識の完成ではない。保存ZIPの旧作業ファイルとしての再読込は未実装。
