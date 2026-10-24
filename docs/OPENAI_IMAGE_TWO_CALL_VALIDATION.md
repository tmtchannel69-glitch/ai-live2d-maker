# 2回試験への更新：検証結果

2026-10-24、基準1988679、同じfeature/openai-image-pilot-preparation。作業開始時のHEAD/変更なし/remote一致を確認。これは**AI実行前の準備とシミュレーション**であり、実画像や実課金の成功ではない。

| 検査 | 結果 |
| --- | --- |
| 公式仕様の取得 | OpenAI公式OpenAPI8243cc8を取得し、固定commitの原文SHA一致も確認。モデル/生成/編集/透過/品質/size/input fidelityを比較 |
| 公式料金 | モデル/料金/guideWebはCONNECT403。API定義に現行の画像単価はなく、3モデルとも未確認。推定/最大費用nullを維持 |
| 3モデルの計画 | 1.5/Flare固定版/Sunburst固定版の各2requestのfieldsを公式JSON Schemaで照合。将来の画像入力はplaceholderで表す構造検査で、実画像の受付確認ではない |
| 通常/最大呼出し | 2/2。参照1枚＋iris_l1枚、自動/手動追加retry0。現在の許可済み送信0 |
| 予算 | 提案枠1 USD。単価と各call最大課金が未確認のため実行不可、現在の支出許可0 USD |
| 会計ロジック | 未確認価格≠0、全入力/出力の整数microUSD計算、事前予約の予算超え拒否、3回目拒否、timeout予約保持/停止、想定外実費の記録/停止をシミュレーションで確認 |
| 新しい準備の再現 | 8ファイル全バイト一致。2request JSON/1guide PNG/plan/価格status/費用比較/予算simulation/確認書 |
| 旧版の維持 | --legacy-six-callの14ファイルが1988679の実物と全バイト一致。元33パーツ/モデル/画像変換のソースも変更なし |
| テスト | Node142件（追加10）、関連ブラウザ21件、build成功。全156ブラウザの再実行ではない |
| API/画像生成/実課金 | 未実行、キー読取なし、外部AI送信0/課金0。新AIモデルのCreator検査/自然さの合格もない |

budget simulationは実API executorに接続していない。テストの正の単価/課金額は仮の数字で、GPT Imageの公式料金ではない。将来のbackendには信頼する単価/課金上限、オーナー承認、送信前の台帳の原子的・永続的・直列な予約が必要。API側の絶対的なUSD上限は未確認で、レスポンスのusageを見てから止めるだけでは保証できない。現時点の実課金上限は、送信機能がないため0 USD。

```sh
node --test scripts/model-build/test.mjs scripts/model-build/*.test.mjs scripts/inochi2d/*test.mjs scripts/character-generation/*test.mjs scripts/ai-image-pilot/*test.mjs
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test tests/character-generation.spec.js tests/character-inochi.spec.js tests/character-design.spec.js tests/inochi-model.spec.js
npm run build
```

Node24.19.0/Chromium151.0.7922.173。ブラウザへ新しいキー設定/送信コードを配信していない。iPhone/Windows/Safari実機や、APIアカウントのモデル利用可否は検証していない。

更新ファイルはmodel-profiles/two-call-plan/cost-control、prepareと版別validator、料金status版2/旧版1、追加テスト、計画/全文/進捗の文書。check-partsの意味判定/旧PNG検査は維持。候補の品質や価格順位を、モデル名や公式SDKの対応型から決めていない。

既定FlareのPlan IDは`c4a57d8b76580b140562b33c18a798afbc34362397b42fed87bb4872febe1774`。1.5は`1c1521b22391d47bd9857820cc5ad9e7561ef4faf16b3a1421c3020678c8a6de`、Sunburstは`a42cf24407c0159ef15042ec643b85d8f5742a81ce8e148524e0acd3a5ea22be`。指紋は同じ計画かを確認するためで、支出承認やAI出典の証明ではない。[画像なしの実測記録](OPENAI_IMAGE_TWO_CALL_VALIDATION.json)。

実物はGit外の`/tmp/openai-two-call-prepared`/`replay`、`/tmp/openai-two-call-15`、`/tmp/openai-two-call-sunburst`、旧14ファイルは`/tmp/openai-six-call-legacy-preserved`、公開資料は`/tmp/openai-two-call-research`。これらはクラウド内部パスで、iPhone用ダウンロードURLではない。古い約26MB ZIPもSHA`18bf753fd4d94afa443f28bed6648641436b546ed05638a27331d721bf92a1cf`不変。

未完了は、現行公式料金と利用条件の確認、入力込みの通常/最大費用、1 USD枠に収まる実行方針の確認、オーナー承認。その後にサーバー専用の実行器を作り、共通参照と虹彩の本物のAI画像で一貫性/位置/透過/隠れ面を検証する。33役割への拡張と新モデル自身の公式Creator確認は後段のまま。[計画](OPENAI_IMAGE_TWO_CALL_PILOT.md)と[送信全文](OPENAI_IMAGE_TWO_CALL_PAYLOADS.md)を参照。
