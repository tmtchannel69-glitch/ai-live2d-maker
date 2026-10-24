# 外部PNGパーツの比較画面（iPhoneでの手動レビュー支援）

2026-10-25。オフラインの一括PNG取り込み実験画面へ「変更前／変更後」の画像比較を追加。従来の通常キャラ生成、1枚PNG差し替え、品質警告、Inochi2Dモデルの生成とZIP保存は維持。

## 操作

1. 「パーツから生成」→「デザイン指定の端末内描画」で基準キャラを用意。
2. 複数の透過PNGを取り込み、実験モデル生成を完了する。
3. 新しい「元画像と差し替え画像を比較」で取り込んだ役割を選択する。
4. 変更前のテンプレートPNG、取り込んだPNGを横並び（狭いiPhoneでは縦並び）で比較。
5. 各役割の可視画素率、矩形外周接触率、品質警告と合成プレビューを確認する。

画像はすべてブラウザ内の既存Blobから表示。外部通信、ChatGPT/APIの呼び出し、APIキー、課金はありません。切替時に古いプレビュー用Blob URLを破棄し、描画更新時に必要なURLのみ保持。

## 評価の限界

画素率や端との接触は「確認箇所の目安」で、顔立ち・髪・瞳の一致、線や色の自然さ、隠れ面の補完、リギング時の自然さを証明しない。AIの生成元を認証せず、見た目を自動合格にしない。

## 検証

- 追加する純粋関数 `buildExternalPartComparison` のケース: 役割に対応した画素統計の表示、安全なコピー、未取り込み役割の拒否。
- ブラウザE2Eのケース: 2枚の外部PNGを取り込んだあと、選択する役割に応じて元画像/差替画像が切り替わり、通常ZIPが変化しないこと。
- 開発ブランチ上の主要4ファイルの構文検査と純粋関数の単純ケースは完了。ブラウザE2E、iPhone Safari実機、Inochi Creatorでの実動作は未実施。

実行予定コマンド:

```sh
node --test scripts/ai-image-pilot/external-part-comparison.test.mjs
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test tests/chatgpt-batch-part-import.spec.js
npm run build
```

公開アプリへの統合、mainブランチへのマージ、実AI生成画像の検証、公式Live2D Cubism互換はまだ行っていません。
