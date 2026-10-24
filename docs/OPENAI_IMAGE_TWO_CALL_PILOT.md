# 2回だけのGPT Image試験：実行前の比較と制限

2026-10-24。基準`1988679`を維持し、`feature/openai-image-pilot-preparation`で更新。**今回は調査/設計/オフライン準備のみ。実API送信、キー読取、課金、契約、公開/main統合を行っていない。** 既存33パーツ/自動リギング/画像変換は変更しない。

## 公式仕様の比較

今回、[OpenAI公式OpenAPI固定8243cc8](https://github.com/openai/openai-openapi/blob/8243cc8fa6f04430fb1f1a6a2cb926fbeb4f7f26/openapi.yaml)を取得できた。原文SHA256は`cc2a329f77bb06b451b9eb6c14cacd6c1c36276ae778f2d63940fab1c7bbb6f6`。`CreateImageRequest`/`CreateImageEditRequest`/`InputFidelity`とImagesの例を確認し、[SDK固定718aee9](https://github.com/openai/openai-python/tree/718aee979a9c334d37302aeff21cee6cbff4d43c)の記述とも照合した。モデルページ/料金/ガイドWebの公開GETは接続proxyのCONNECT403。公式API定義の取得と、料金/モデルの品質比較の確認を区別する。

| 項目 | GPT Image 1.5 | GPT Image 2.5 Flare | GPT Image 2.5 Sunburst |
| --- | --- | --- | --- |
| 試験で使える明示model | `gpt-image-1.5`（alias） | `gpt-image-2.5-flare-2026-09-08` | `gpt-image-2.5-sunburst-2026-09-08` |
| 生成/参照編集 | 両方のschemaに記載 | 両方のschemaに記載 | 両方のschemaに記載 |
| PNG/透過 | GPT Imageの対応方式として記載 | opaque/transparentを明記 | opaque/transparentを明記 |
| 品質 | low/medium/high | 同左＋xhigh/max | 同左＋xhigh/max |
| サイズ | 標準1024正方形/1536×1024/1024×1536 | 標準＋条件付き任意寸法 | 同左 |
| `input_fidelity` | high/lowの対象として明記 | 2.5への適用の明記がないため送らない | 同左 |
| 今回の指定 | medium/1024正方形/PNG/透過/n=1 | 同左 | 同左 |
| 現行の文章入力単価 | 未確認 | 未確認 | 未確認 |
| 現行の画像入力単価 | 未確認 | 未確認 | 未確認 |
| 現行の画像出力単価/medium1024の出力額 | 未確認 | 未確認 | 未確認 |
| 絵柄/参照保持/速度/実際の費用 | 未実測 | 未実測 | 未実測 |

2.5の任意寸法は16の倍数、縦横比や最大画素/辺の制約がある。今回の1024×1024は3モデル共通の標準寸法に限定し、xhigh/max/autoを使わない。参照の受付、PNG透過、マスクの指定は、独立した正しい部品/元と同じ線/正確な配置の保証ではない。アカウントでの実利用可否もまだテストしていない。

**提案：初回は同じFlareの固定版を2回とも使う。** 公式OpenAPIの生成例で明示されている2.5モデルをまず再現し、参照と部品でモデル/版の違いを増やさないため。安い/速い/最も自然という未確認の優劣を理由にしていない。料金と利用条件の確認が前提で、品質不足なら別の承認済み試験でSunburstを比較する。初回2回の途中でSunburstへ自動切替しない。1.5は文書化されたhigh fidelityを比較する対照として選択可能なまま残す。

## 送信案は最大2回

1. **reference**：文章だけで1体の正面/胸上/通常顔/メイドの共通画像を作る。髪/瞳/肌/服の色、線/陰影と配置の全文を送る予定。以前のユーザー画像は送らない。
2. **iris_l**：同じmodel/版で、本人左（画面右）の虹彩＋瞳孔だけを1PNG生成する。image1は実際に生成された共通参照の固定SHA256/同じバイト、image2は虹彩の矩形/支点だけの技術ガイド。隠れた虹彩も完成させ、白目/まつ毛/肌/ハイライトは含めないよう指定する。

位置は元768×1024を1024正方形へx+128/y+0で移すだけ。拡縮/再配置/はみ出しの消去で失敗を隠さない。元の33役割/座標/支点/alphaの構造を使う。虹彩1枚の試験は目全体の生成や左右まばたき成功ではなく、33パーツモデルも出力しない。

同時実行、複数画像`n>1`、SDK自動retry、モデルfallbackを使わない。**再試行込みで合計2回**であり、2回＋再試行2回ではない。失敗/タイムアウトは1回として数えて停止する。別の実行/作り直しには新しい試験計画と承認が必要。料金確認前にこの2回を許可したわけではなく、現在の許可は0回。

[既定デザインの全文・画像添付一覧](OPENAI_IMAGE_TWO_CALL_PAYLOADS.md)。参照PNGは未生成でSHAはnull、生成後に位置/同一性を確認し固定してから2回目へ進む。実行前には使用する実model、全文、実際の画像、最大予算を再提示する。

## 費用：見積もりと上限を分ける

| 項目 | 現在の値 |
| --- | --- |
| 通常/再試行込みの最大呼出し | **2回** / **2回** |
| 出力画像 | 2枚 |
| 画像入力 | 2回目に参照1枚＋ガイド1枚、計2枚。1回目は0枚 |
| 公式料金 | 3モデルとも未取得。単価null。記憶やモデル名の印象で補わない |
| 通常の推定費用 | 未算定。`C(reference) + C(iris edit)`、文章/画像入力と出力を含む |
| 再試行込みの推定最大費用 | 未算定。追加試行は0回なので、2回分の料金範囲内で計画する |
| **提案する試験予算枠** | **合計1.00 USD**。料金見積もりでも支出承認でもない。為替/税/決済手数料は別途確認 |
| **現在許可済みの支出** | **0 USD / 0回** |

料金ページ：[OpenAI料金](https://openai.com/api/pricing/)、[1.5](https://developers.openai.com/api/docs/models/gpt-image-1.5)、[Flare](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare)、[Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)。オーナーには公式表/URLの文章共有も依頼した。今回は料金が得られるまで送信しない。

モデル別の見積もり入力/取得可否は`server/ai-image-pilot/pricing-status.json`。文章/画像入力/画像出力のUSD/百万token、各requestのusage見込み、検証済みの最大課金額を別々に記録する。現在は未確認なので3モデルとも推定/最大費用をnullで出力する。キャッシュ割引は前提にしない。

`cost-control.mjs`はすべての入力/出力を合計してmicroUSDの整数で会計し、不明な価格を0と扱わない。`tokenCostMicrousd`では小数の単価を文字列で受け、小数6桁まで保持して合計をmicroUSDへ切り上げる。テストの仮単価は計算検証用で、実モデル料金ではない。

**送信前の最大費用予約が確認できなければ実行不可。** 各requestの入力込みの課金上限を信頼できる資料から確認し、`支出済み＋未確定の予約額＋次の最大費用 <= 1 USD`を満たすときだけ予約する設計。未確定timeoutは返金/未課金と扱わず、全予約を保持して停止。想定外の実費は記録して停止し、超過を消して検査を通さない。

この予算ロジックは現在**オフラインの状態遷移シミュレーション**。実API executorは存在しない。将来は承認済みのbackendだけが台帳を直列/永続/原子的に更新して送信する必要がある。モデルのAPI schemaには金額上限も`max_output_tokens`もなく、レスポンス後にusageを読むだけでプロバイダー側の課金を必ず1 USDに止める保証にはならない。信頼できる1回の最大課金が確認できなければ、提案枠に収まると推測して実行しない。現在保証できる実課金上限は、未送信の**0 USD**。

## キー、品質、既存機能

APIキーは承認後もサーバーの秘密管理/`OPENAI_API_KEY`だけに置く。ブラウザ/VITE_*、CLI引数、JSON/manifest、Git、ログ、会話へ値を置かない。今回はキーを読まない。新しいSDK/実送信routerも追加しない。APIの保存/学習/出力利用条件は未確認で、SDKのライセンスを代用しない。

PNG構造の検査は引き続き1024正方形/8bit RGBA、空/部品内の不透明背景/範囲外を拒否し、元座標/alpha/透明RGBを保持する。参照との一貫性、色/線、隠れた虹彩、透過の市松模様などは実画像で別検証する。構造が通るテストfixtureやガイドをAI生成成功と扱わない。

33役割への拡張、左右目/10開度、首/髪の接続、真のAI出典adapter、既存Inochi2Dへの接続と新モデル自身のCreator確認は、今回の2回試験の品質を確認した後。Cubism/VTube Studio互換の検証ではない。

## 再生成と互換

```sh
# 既定はFlare固定版の2回計画。キー/ブラウザ不要、API送信なし。
node scripts/ai-image-pilot/prepare.mjs --output /tmp/NEW-two-call
# 別モデルの計画だけを作る。実験を実行する指定ではない。
node scripts/ai-image-pilot/prepare.mjs --model gpt-image-2.5-sunburst --output /tmp/NEW-sunburst-plan
node scripts/ai-image-pilot/prepare.mjs --model gpt-image-1.5 --output /tmp/NEW-15-plan
# 1988679の旧6request準備をそのまま再現するだけ。現行の実行承認対象ではない。
node scripts/ai-image-pilot/prepare.mjs --legacy-six-call --output /tmp/NEW-legacy-plan
```

新版は8ファイル：2request JSON/1guide PNG/plan/料金status/費用比較/予算シミュレーション/実行前確認書。旧版1の14ファイルも1988679と全バイト一致を確認した。旧6request生成/検査の入口を保存し、新版2の検証を追加。`--execute`は引き続き存在せず、未知model/拡大した回数・予算/偽の承認を拒否する。

PNG/モデル/ZIP/実物はGit外。ソース/設定/公開資料の指紋/全文/再生成手順だけを同作業ブランチへ保存する。既存33部品/Native生成/画像変換のコードを変更せず、main統合/公開を行わない。[検証結果](OPENAI_IMAGE_TWO_CALL_VALIDATION.md)。
