# AI画像生成の実証準備：検証結果

2026-10-24、`08c0edd`から新規`feature/openai-image-pilot-preparation`へ分岐。未コミット変更なし/元リモートとの一致を確認して開始。これは**実AI生成前の準備**の結果で、AIパーツの生成や見た目の成功報告ではない。

## 今回できたこと

- 既存の共通デザイン/blueprintから、参照1件と5つの独立layer editの全文/添付計画を作成。暫定候補`gpt-image-1.5`、参照を毎回同じSHA256で固定する方式、ガイドとの2画像入力を定義した。
- APIの1024正方形へ768×1024をx+128で配置し、元座標/支点/親/前後関係を保持する方式を準備。配置ガイド5PNGは矩形/支点だけで、生成されたキャラクター素材ではない。
- 通常6回/各1回追加で最大12回の試験案、入力画像添付10/最大20件、費用の式と停止条件を保存。現行単価は未確認で推定/最大USDともnull、実行許可は0回/0USD。
- 空/不透明背景/範囲外の画素を拒否し、正常なtileの位置/straight RGBA/透明画素のRGBを変えずに切り出す検査を追加。PNGの構造だけでAI出典や自然さは認定しない。
- 送信transport、キー読取、SDK依存、FastAPI router、ブラウザのキー設定を追加していない。`--execute`は未知オプションとして拒否する。`.env`/`.env.*`をGit除外した。

## 実測

| 判定 | 結果 |
| --- | --- |
| 準備コマンド | APIキー/ブラウザなしで成功。6request JSON、5技術図、plan/価格status/確認書の計14ファイル |
| 再生成 | 同設定から14ファイルすべて全バイト一致 |
| Node | 開始時121件、追加後132件（新規11件）すべて成功 |
| 関連ブラウザ | 既存のcharacter-generation/character-inochi/character-design/inochi-model計21件成功。全156件の再実行ではない |
| build | 成功。新pilot/OPENAI_API_KEYはブラウザ配信物へ含まれない |
| 既存機能 | src/shared、旧33パーツ/モデルCLI、server/app.pyを変更していない。旧約26MB ZIPのSHAも不変 |
| 実AI生成/課金 | 未実行、外部AI送信0、課金0 |
| 公式Creator | 今回は未実行。生成モデルの変更がなく、以前の合格を実AIへ流用しない |
| AI画像の品質 | 未検証/未合格。ガイド/合成fixtureをAI画像の成功としていない |

新規テストは、同じ参照の再利用、別layer/座標、6/12回の正しい計数、改変されたprompt/endpoint/承認状態の拒否、JSONキー順の許容、PNGサイズ/空/全背景/部品tile内の不透明背景/はみ出し、半透明と透明RGB保持、ガイドや1画素が構造に合っても意味的な合格としないこと、Git内/symlink経由/上書き拒否、不足入力での出力拒否、秘密値の出力混入防止を確認する。メモリ上のRGBAと技術図はテスト用で、本物のAI品質の検証ではない。

```sh
node --test scripts/model-build/test.mjs scripts/model-build/*.test.mjs scripts/inochi2d/*test.mjs scripts/character-generation/*test.mjs scripts/ai-image-pilot/*test.mjs
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test tests/character-generation.spec.js tests/character-inochi.spec.js tests/character-design.spec.js tests/inochi-model.spec.js
npm run build
```

Node24.19.0/Chromium151.0.7922.173、390×844の設定を含むブラウザ検証。iPhone/Windows/Safariの実機確認ではない。アプリの依存は追加しなかった。

Plan IDは`e339f04bfdc391d23c8d18c3914b13f282aba26ff90493e6d020272c053260cc`。完全な[数値/取得可否の記録](OPENAI_IMAGE_PILOT_VALIDATION.json)、[送信予定の全文](OPENAI_IMAGE_PILOT_PAYLOADS.md)、[仕様/費用と再現手順](OPENAI_IMAGE_PILOT.md)。SHAは同じ計画か確認する指紋で、オーナー承認やAI出典の署名ではない。

## 保存と未解決

準備の実物は`/tmp/openai-image-pilot-prepared`、同設定の再生成は`/tmp/openai-image-pilot-replayed`、公開資料の取得結果は`/tmp/openai-image-pilot-research`へGit外に保持。これらはクラウド内部パスで、iPhone用ダウンロードURLではない。以前の画像/モデル/ZIPは変更しない。旧ZIP SHA`18bf753fd4d94afa443f28bed6648641436b546ed05638a27331d721bf92a1cf`。

公式価格/契約/データWebは今回もCONNECT403で未取得、直接の公開GETもDNSで失敗した。公式SDK/ルートと古いcookbookの技術記述は確認できたが、現行単価、通常/最大USD、モデル利用可否、保管/利用条件は未確定。SDKソースだけで料金を推測しない。ユーザーが公式表を確認できる場合の文章共有も依頼し、回答がなくてもAPIを実行せず準備まで進めた。

次はこの未確認事項を埋め、実際の送信内容と費用/上限をオーナーに提示する。承認後に初めて限定したserver-only providerと試行台帳を実装し、参照→5layerの実画像で検証する。5役割で自然さが確認できたら左右目/10開度→全33役割→明示したAI出典adapter→既存Inochi処理→新モデル自身の公式Creator保存/再読込へ進む。現在の初回5layer用CLIから直接モデル化はしない。
