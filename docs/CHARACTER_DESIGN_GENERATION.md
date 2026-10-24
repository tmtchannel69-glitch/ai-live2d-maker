# 共通デザインからの33パーツ生成

2026-10-24。`feature/part-first-character-generation`の`ccbb93a`を継続。オーナーは設計、外部送信/新課金なしの実装と検証を承認。実AIの契約・課金・外部送信は未承認。通常の33パーツ版1と画像1枚→Inochi2Dは維持する。

## 現在の依存と変更方針（実装前）

| 現在の依存 | 今回の対応 |
| --- | --- |
| recipeは髪色/瞳色/背景、生成元はtemplate/dummyだけ | 旧版1は維持し、デザイン仕様と版2の出力を追加 |
| 独立したパーツごとのprovider呼出し | 一つのdesign/blueprintを入力に33パーツをまとめて返す契約を追加 |
| 768×1024、固定の矩形/支点 | 今回は同じキャンバスを保ち、顔・目・髪・首から部品の矩形/支点/親子を再計算 |
| 首の追従開始はpivot+11、40pxで固定 | 新版は顎/襟の接続位置から追従範囲を計算。旧版の数値は維持 |
| まつ毛は暗色、白目は一定サイズを想定 | 前提と失敗を検査し、対応外の絵をダミーで埋めない。任意のAI画像への一般化は未合格 |
| PNGごとの可視alpha/サイズ検査のみ | 共通design ID、33役割、接続/重なり、モデル変形、元PNGとの比較を追加 |
| 元の生成器はブラウザ/Node共通 | 既存の合成/mesh/serializer/公式保存検査を再利用する |

## データと生成方式

一つの`character_design.json`で髪型/髪色、目の形/瞳色、顔立ち、服装、雰囲気、共通の色/線/陰影を定義する。正面・胸上・アニメ調・通常顔を固定し、`design_blueprint.json`へ33役割の位置、前後、支点、親、マスク、接続点、隠れ領域、首の変形範囲を計算する。本人左右と左上ピクセル座標を維持する。

生成providerはcharacter単位で同じblueprintと共通styleを受け取り、33PNGを一つのbatchとして返す。将来のAIではデザイン参照→共通参照を条件にしたパーツ群→隠れ部分補完→RGBA検査を優先し、独立33回の無関係なpromptを既定にしない。背景除去・部分補完・位置合わせは生成APIが自動保証するとは扱わない。

新しいmanifestは版2。元の33役割/座標/alpha/親子を維持し、生成方式/モデル/デザインID/出典を記録する。静止/動作モデル/自然さ/AI一貫性は別判定。端末内の描画は常に`ai_generated:false`。未接続AIを実行したふりをせず、未知providerは明示的に拒否する。

## 実装順とファイル

1. `shared/character-design.js`：正規化されたデザインと共通パレット、blueprint、character単位のAI依頼データ。
2. `shared/designed-character.js`：版2と33パーツのbatch整合性。旧版の形状検査を共通化して再利用。
3. `src/character-generation/design-provider.js`/`design-generator.js`：既存の独立SVGを再利用した端末内のデザイン指定描画と合成。これはAIでなく、有効な別デザインで配置/接続を試すための機能。
4. `shared/generated-character-inochi.js`：モデル構築を共通化し、旧版と新しい設計由来の首/頭情報を別の入口から渡す。旧モデルのSHA/素材を保持。
5. `panel.js`/`archive.js`とCLI：新しい指定画面、保存/再生成、AI依頼仕様の端末への出力。ネットワークprovider/認証情報は組み込まない。
6. 複数の端末内デザインで実PNG/メッシュ/瞬き/首/髪/元プレビューを検査する。実AIの画像品質は未実施と記録。新モデルの公式Creator確認も旧版から流用しない。

## 外部AIを実行する前の条件

候補のモデル/版、地域、最新の公式単価、1体の生成・再試行・編集・背景処理の上限、送信する文章と画像、保存/学習/ライセンス条件を提示してから、オーナーの承認を得る。APIキーはサーバー側で扱い、画面やGitに保存しない。設定ファイルやアプリ内のチェックをオーナーの外部送信承認に置き換えない。

今回の公式料金/利用条件ページへのGETは接続proxyの403で取得できなかった。未確認の最新単価を捏造しない。比較の取得可否と候補の制約を別資料へ残す。GPUデバイスも検出できておらず、未検証のローカルdiffusionを実行済みと扱わない。

詳細な[provider比較と費用/送信の承認票](AI_PARTS_PROVIDER_COMPARISON.md)、[実測と未完了部分](CHARACTER_DESIGN_VALIDATION.md)。実AIは未接続のまま、端末内描画の3デザインは公式Creatorで保存/新プロセス再読込まで検証した。

## 現在使える範囲

アプリの「パーツから生成」→作り方「デザイン指定の端末内描画」を選び、特徴を指定する。髪型はロング/ボブ、目は丸い目/アーモンド形/つり目、顔はやわらかい/すっきり、服はクラシック/カフェのメイド2種、雰囲気は穏やか/明るい/クール。色は6桁の任意色を使える。肌と服/リボンの色も同じパレットから描く。これは任意の髪型や衣装を理解するAIではなく、対応範囲を明示した端末内描画。

生成後のZIPは49項目。旧45項目に`character_design.json`/`design_blueprint.json`/`ai_generation_request.json`/`design_quality.json`を追加する。旧版1は同じPNG/manifest/45項目ZIPを保つ。AI依頼仕様の単体保存も可能で、保存ボタンは外部送信を行わない。設定を変えても前回の結果を保持し、生成が全部成功したときだけ置き換える。

`character-design.schema.json`と`designed-character.schema.json`を追加した。JSの検査はJSON Schemaに加えて正規化した全設計を照合する。JSONオブジェクトのキー順の差は許容し、役割/変形配列順や値の差は拒否する。生成元は現在local-design-v1のみ。外部AI接続時は実応答の出典と画像/共通参照の指紋をサーバーで記録し、origin検証とadapterを追加する。自己申告の`ai_generated:true`を受け取って接続済みと扱わない。

## 再生成する

NodeとPlaywright/ChromiumだけでPNGとモデルを生成できる。AI用のPython/Torch/モデル重みは不要。

```sh
npm ci
npx playwright install chromium
npm run dev
```

別ターミナルで次を実行する。出力先の親は存在し、末尾のディレクトリは未作成かつGit外である必要がある。

```sh
# 設定済みの3デザインを一括生成。参照画像は不要、実AIは呼ばない
node scripts/character-generation/design-trial.mjs --output /tmp/NEW-design-matrix
# ZIPから取り出したデザインで再実行
node scripts/character-generation/export.mjs --design /path/to/character_design.json --output /tmp/NEW-design
# 同じgeneration_recipeも読める
node scripts/character-generation/export.mjs --recipe /path/to/generation_recipe.json --output /tmp/NEW-replay
# 保存済み33PNG+manifestからモデルだけ再作成
node scripts/character-generation/model.mjs --input /tmp/NEW-design --output /tmp/NEW-model-only
```

このクラウドではコマンドの前に`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`を指定する。WindowsのPowerShellでは、`--output "$env:USERPROFILE\Documents\NEW-design-matrix"`などへ置き換える。Windows/Safari/iPhone実機は未検証。デザイン識別にはWebCryptoを使うので、Web画面はHTTPSまたは同じ端末のlocalhostで開く。クラウドのlocalhostをiPhoneのローカルURLとして案内しない。

生成レポートには実行したコードのcommit/未コミット状態/生成コードの指紋、設定、ブラウザ実行ファイルと実バージョン、ZIPの指紋を保存する。同じLinux Chromiumでの全バイト一致を確認したが、異なる描画エンジン間のPNG一致は保証していない。

## 任意の診断と公式確認

独立CPUの比較だけを実行する場合、Python3.12の別環境へ軽い依存を入れられる。TorchやAI重みは不要。

```sh
python3.12 -m venv /tmp/design-diagnostics-venv
/tmp/design-diagnostics-venv/bin/python -m pip install -r scripts/character-generation/requirements-diagnostics.txt
node scripts/character-generation/design-trial.mjs --output /tmp/NEW-design-quality --python /tmp/design-diagnostics-venv/bin/python
```

現在の`.venv/bin/python`も使用できる。Windowsは対応する`Scripts\python.exe`を指定する。各24状態のPNG/mesh/首/目と口の独立/中立比較を出す。CPU描画を公式SDKの成功や自然さの合格に代用しない。

公式Creatorは[既存の固定環境](INOCHI2D_CREATOR_CHECK.md)を準備する。Linux公式0.8.6/Xvfb1280×960/指定dock配置の専用検証。初期設定/Parameters表示は準備済みである必要があり、他のCreatorが起動中なら自動操作を拒否する。

```sh
.venv/bin/python scripts/character-generation/creator-trial.py \
  --input /tmp/NEW-design-quality --output /tmp/NEW-official-quality \
  --creator /path/to/official-0.8.6/inochi-creator \
  --runtime /path/to/prepared-inochi-runtime --xdotool /path/to/xdotool
```

`--names bob,cool`等で対象を選べる。通常の起動案内の待ち時間を経てCloseを確認し、26状態→実保存→新プロセス26状態→画像/階層保持と表示差を記録する。モデルを手動編集/リギングして試験を通していない。Windowsでは同じINXを手動で開き、6制御と保存・再読込を確認する。Windowsでの自動GUI検証を実装済みとは扱わない。

## 残る依存

共通の参照形状、768×1024、固定の33役割/親子/基本メッシュ密度は残る。任意AI絵の頭/目/首/髪根元を推定する認識器は未実装。デザインの違いでPNGの矩形/支点/mesh位置/首変形/頭の移動量を再計算するが、生成された任意の絵から最適meshを推定する機能ではない。

現在のAI依頼仕様は共通のtarget blueprint。実providerでは、生成後のalpha領域・接続点を正規化するadapterと見た目/一貫性の検査、失敗した部位の再生成が必要。メイド以外で不要となるapron等の扱い、任意の髪型/服装、マスク/隠れ部分の妥当性は後続の仕様決定。未対応の指定を黙ってテンプレートへ落とさない。
