# 外部PNGの画素品質警告（オフライン検証）

2026-10-24。複数パーツ取り込みを使った試験の際に「入力の構造は有効でも見た目が破綻しそうなパーツ」をユーザーが発見できるように、数値に基づく警告を追加しました。

## 実装内容

- `shared/external-part-quality.js` : ブラウザでデコードしたRGBA画像を1回走査し、指定矩形の可視・透明・半透明画素、矩形外の可視画素、可視画素の範囲、端の接触率を集計する純粋関数。
- `src/character-generation/external-part-batch.js` : 既存の範囲外拒否と透明領域の必須条件は維持し、計測値と警告を `experimental_batch_report.json` に追加。全ファイルの検査を終えるまで元キャラを変更せず、モデル構築は1回のみ。
- `src/character-generation/external-part-batch-panel.js` : 合成後に対象役割ごとの警告を表示。警告がない場合も人間の絵柄・隠れ領域・人物一致確認は必要と明記。

## 警告（合否とは異なる）

| コード | 条件 | 意味 |
|---|---|---|
| `very-low-coverage` | パーツ矩形内の可視画素率 <1% | 実際のパーツより極端に小さい可能性 |
| `almost-opaque-tile` | 可視画素率 >98% | 透過漏れや不自然な背景の疑い |
| `high-edge-contact` | 矩形外周に接している可視画素率 >55% | 切断線・素材のはみ出しを目視確認 |

定義：不透明だけでなくアルファが1以上の画素を可視とする。パーツの矩形サイズ、可視境界、部分的なアルファも計測してJSONへ保存。警告はあくまで**ヒューリスティック**。髪の毛が自然に矩形境界にかかることもあるため、警告だけで生成を拒否しません。

アルファの有無だけではアニメキャラの絵柄、隠れた皮膚や髪、レイヤーの意味的正しさ、著作権、AIの本物の生成元を証明できません。`appearance_quality_passed:false`、`human_visual_review_completed:false`は従来どおりです。ゼロ警告も完成の保証ではありません。

## 実施した検証と未実施

新規の純粋関数に対し、保存したソースを取得して実行した5ケースで正常動作を確認：通常の透明パーツ、極小描画、ほぼ不透明＋境界接触、矩形外画素、異常な引数。

```sh
node --test scripts/ai-image-pilot/external-part-quality.test.mjs
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test tests/chatgpt-batch-part-import.spec.js
npm run build
```

上記のNodeテストはリポジトリに追加。ブラウザでの動作・ビルド・iPhone Safari実機・Creatorでの実モデル品質についてはこの変更で確認していません。Webサービス公開・外部生成API課金・APIキー利用は行いません。

## 既存機能への影響

旧「画像1枚から変換」や1パーツ取り込み、従来の33パーツローカル生成・INP/INX生成、通常キャラクターZIPは変更しません。実験版の一括取り込みだけが追加で警告を表示し、検査した画素統計を保存します。mainには統合していません。
