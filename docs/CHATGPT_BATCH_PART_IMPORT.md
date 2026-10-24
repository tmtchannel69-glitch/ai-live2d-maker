# ChatGPTで作った複数PNGの一括取り込み（ローカル実験版）

2026-10-24。既存の「外部PNGを1枚取り込む」実験を残したまま、ChatGPTなどで制作した**複数の独立透過PNG**を基準デザインへ一括差し替えする別UIを実装した。

## iPhoneからの使用手順

1. 「パーツから生成」→「デザイン指定の端末内描画」で、基準となる33パーツとInochi2Dモデルを生成。
2. 下部の「透過PNGをまとめて取り込む（試験版）」を開く。
3. ファイル名が役割名そのもの（例：`iris_l.png`、`iris_r.png`、`bangs_front.png`）となっているファイルをiPhoneから複数選択する。本人左が画面右。
4. 事前一覧で取り込み枚数・不足枚数・重複や不明な役割のエラーを確認する。
5. 「選択したパーツをまとめて取り込む」を押す。選択PNGをすべて構造検査し、成功した場合だけ合成とモデル再生成を各1回行う。
6. 別プレビューで確認してから「モデル・33パーツ・検証記録をZIP保存」を選ぶ。

## 入力・検証の仕様

- ファイル名が既存の33役割と完全一致するPNGのみ。大文字混在・重複・未知役割・画像以外は拒否。
- 1〜33枚を選択可能。1枚8MB以内、合計12MB以内。
- 対応画像：選択パーツの切り抜きサイズ、768×1024基準座標画像、1024×1024（X+128）API座標画像。
- 8bit RGBA PNGの署名/ヘッダーと復号後サイズを確認。パーツ矩形の外側に可視画素があれば拒否し、矩形の内側に可視と透明の両方がなければ拒否する。
- 細かい線の正しさ、隠れ面の描き足し、見た目の一貫性、人物の一致、AI出典は別の品質レビューが必要。
- PNGであると見せかけたファイルや、完成絵全体をパーツとして入力することは成功扱いしない。
- ファイルの検査は全件終えるまで基準モデルを変更しない。途中失敗/中止では外部PNGを適用せず、元の完成物をそのまま保持。
- 認証・ネット送信・API課金は一切実施しない。

## 出力ZIP

`ai-live2d-batch-parts-experiment.zip` に以下を含む。

- `parts/*.png`：合計33枚（入力されたパーツ＋選択されなかったテンプレートパーツ）
- `preview.png`：実験用の合成プレビュー
- `character.inp` / `character.inx`：Inochi2D 0.8.6向けの実験モデル
- `character_manifest.json`：基準デザインのサイズ・配置・親子・クリップ情報
- `experimental_batch_report.json`：外部入力役割・残存テンプレート役割・各ファイルSHA256・生成検証状態
- `inochi_report.json` と `README.txt`

**重要：** `character_manifest.json` の `generator` は基準キャラ由来の`local-design-v1`です。外部差し替え元は`experimental_batch_report.json`に記載。33枚を外部PNGで置き換えても、自動生成されたAIである証明や商用公開の品質保証にはなりません。

## 互換性・未実施

- 既存の生成結果、従来の単独PNG差し替え、通常のZIP、旧画像1枚からの変換には変更しない。
- `main`には統合せず、実験ブランチに保存。
- ユーザーがChatGPTで画像を作り、iPhoneに保存する手順はまだ必要。1枚の完成イラストを自動で33パーツ分割する機能は未実装。
- 現在の出力はInochi2DのINP/INX形式。公式Cubism形式やVTube Studio互換ではない。
- 公式Inochi Creator実機、iPhone Safari実機、全ブラウザでの動作・見た目・33パーツすべて外部画像を使った結果は未検証。

## 実行予定テスト

```sh
node --test scripts/ai-image-pilot/batch-import.test.mjs
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test tests/chatgpt-batch-part-import.spec.js
npm run build
```

これらは実行予定コマンドであり、GitHubへコードを保存しただけで実施済みとは扱わない。
