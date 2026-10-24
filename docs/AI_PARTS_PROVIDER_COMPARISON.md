# AIパーツ生成providerの比較と承認前の条件

最新のOpenAI内の比較は[GPT Image 1.5/2.5 Flare/2.5 Sunburstと2回試験](OPENAI_IMAGE_TWO_CALL_PILOT.md)。公式OpenAPIで3モデルを照合し、初期案を参照1回＋虹彩1回へ縮小。単価は依然未確認で、1 USDは予算案、実行許可は0回/0USD。

調査日2026-10-24。**AIへの文章/画像送信、APIキー設定、契約、課金、モデル重みの取得・実AI生成は行っていない。** 現在の機能は端末内の図形描画を基にした共通デザイン/パーツ/リギングの検証で、AI成果物ではない。

次のオーナー指示でOpenAIを第一候補とした[少数パーツの実行前計画](OPENAI_IMAGE_PILOT.md)を追加した。参照保持highを公式SDKで確認できるgpt-image-1.5を暫定候補とし、通常6/最大12回の送信予定を準備。価格Webは再調査も403でUSD費用は未算定、実行/課金/外部送信は引き続き0。新しい型がSDKにあることだけで、最新/最良のモデルやアカウント利用可否とは評価しない。

## 確認できたこと・確認できなかったこと

公式料金/利用条件/モデルカードWebページへのGETは、接続proxyの`CONNECT 403`で失敗した。別の承認済み読み取り方法でも同じだった。単価を現在の料金として捏造せず、価格/契約本文/地域ごとの利用可否は未確認とする。APIの実呼出しや外部アップロードで接続確認はしない。

公開GitHubから次の公式ソースを読み取れた。SDKの対応型は、アカウントの実アクセス権、モデル品質、料金、モデル自体の利用許諾の証明ではない。

- [OpenAI公式Python SDK、固定718aee9](https://github.com/openai/openai-python/tree/718aee979a9c334d37302aeff21cee6cbff4d43c)。[画像編集の型](https://github.com/openai/openai-python/blob/718aee979a9c334d37302aeff21cee6cbff4d43c/src/openai/types/image_edit_params.py)には共通参照画像の配列（最大16）、PNGマスク、透過背景が記載。モデル候補は`gpt-image-2.5-sunburst-2026-09-08`等で、最新名へ自動追従させず実接続前に固定する。SDK自身のApache-2.0を確認。
- [Google公式GenAI SDK、固定c0e9c54](https://github.com/googleapis/python-genai/tree/c0e9c54915970948258226e565bde6ef6d5c0b94)。READMEにGemini画像モデル例`gemini-3.1-flash-lite-image`、Imagen例`imagen-4.0-generate-001`、画像編集の入口。SDK自身はApache-2.0。GeminiとImagenの能力・料金を混同しない。
- [Black Forest Labs公式FLUX、固定802fb47](https://github.com/black-forest-labs/flux/tree/802fb4713906133fcbd0d8dc5351620ca4773036)。[schnellモデルカード](https://github.com/black-forest-labs/flux/blob/802fb4713906133fcbd0d8dc5351620ca4773036/model_cards/FLUX.1-schnell.md)は12B/1〜4steps、[schnellのApache-2.0本文](https://github.com/black-forest-labs/flux/blob/802fb4713906133fcbd0d8dc5351620ca4773036/model_licenses/LICENSE-FLUX1-schnell)を確認。`dev`/Fill/Canny/Depthの非商用ライセンスをschnellと混同しない。

## 比較

| 方式 | 統一デザインとパーツへの適用 | 実行環境・透過 | 料金 | ライセンス/データ |
| --- | --- | --- | --- | --- |
| 現在の端末内描画 | 共通の設計と色から33PNG、隠れた肌等は完全な形を描く。選択肢は限定、AI自由生成ではない | ブラウザ/Node+Chromium。外部送信なし、RGBA可 | API料金0。端末の計算費は別 | 既存の自作描画を再利用。新たなAIモデル規約なし |
| OpenAI GPT Image系 | 一つのキャラ参照と同じblueprintを、部位群/編集マスクに共通利用する候補。独立33promptは避ける | 外部API。SDKにPNG/透過/マスク/複数参照の記載。位置やhidden layersの正解は保証しない | **最新単価未確認、利用/課金不可**。入力画像/文章/出力・再試行・補完を含めて見積 | SDKはApache2、画像API契約/生成画像の権利/保存・学習設定は別で未確認 |
| Google Gemini画像系 | 共通参照を使った編集の候補。33役割の独立出力と一貫性は実測が必要 | 外部API。透過PNGや厳密な部品配置を未確認のまま対応としない。必要なら既存マスク/alpha処理を併用 | **最新単価未確認、利用/課金不可**。無料枠の存在を無断外部送信の許可にしない | SDKはApache2、Gemini/Imagenのサービス条件、保存/学習/商用条件は別で未確認 |
| ローカルFLUX.1 schnell | 生成の出発点。単体で共通キャラの33部品/hidden anatomy/alphaを保証しない。参照条件付けや補完の追加構成が必要 | 通常GPUを使う候補。この環境はPyTorch2.5.1+cpu、CUDAなし/デバイス0、nvidia-smiなし。実行していない | 自分のPCでホストする場合のAPI従量料金は0。GPU/メモリ/電力/導入・運用費は別。クラウドGPU調達は別承認 | schnell重みApache2を確認。付属encoder/VAE/追加adapter/素材の条件は別途。dev系の条件を流用しない |

品質の実測順位は未作成。実AIを試さず「最も自然」「一貫性合格」とは評価しない。schnellの12Bパラメータを16bitで保持するだけでも約24GB相当で、他のモデル/実行領域は別。量子化/CPU offloadで必要量は変わるが、この環境での速度/メモリ/品質を測っていない。小型テストモデルやダミーをアニメパーツ生成の成功としない。

## 推奨する試験構成

設計→1体の参照デザイン→同一参照/パレット/線/陰影/配置を使った部位群→独立した完全なRGBA層→33役割検査→組み立て→モデル化、の順にする。参照絵を後から単純分解する方式へ置き換えない。目/口の幾何を端末内で保ち、髪/服/肌の描き込みへAIを使う混合方式も比較候補。ただし各役割がAI/端末内/補完のどれかを正直に記録する。

外部APIを選ぶ場合、OpenAI系の参照/マスク/透過の契約が確認しやすいことを理由に、まず**価格・契約確認の候補**とする。採用/実測合格ではない。ローカルを優先する場合は、既存の私用GPUの有無と利用条件の調査から始め、無断でクラウドGPUを借りない。

## 費用と送信の承認票（未承認）

現時点の外部実行上限は**0回/0USD**。未確認の価格のまま課金を承認してもらう依頼はしない。見積を確定できた時に、次を提示する。

1. 固定したprovider/モデル版、公式価格URL、確認日、解像度/品質/課金単位。
2. 参照生成数R、部位生成数P、補完数F、再試行上限N。`総額 = 参照R + 部位P + 補完F + 再試行Nの各API料金 + 画像入力/文章入力の料金 + 必要なalpha処理/計算費`。33PNGを出すことと33回APIを呼ぶことを同一視しない。
3. 1体あたりと試験全体のUSD/JPY上限、税/為替の前提、途中停止/再試行の扱い。契約費/従量費/インフラ費を分ける。
4. 送信先、デザインの文章、参照/途中パーツ/マスク画像の一覧。以前のオーナー画像はこの試験の送信対象に自動追加しない。
5. データ保存/学習設定、削除方針、地域、画像モデル/出力/参照素材/依存モデルのライセンス条件。

現在出力する`ai_generation_request.json`は、端末へ保存する設計資料。モデル名、価格、秘密鍵や実画像のbase64を含めず、`request_sent:false`/`ai_generation_performed:false`。これを保存したり、UIで選んだことを外部送信の承認と扱わない。

未取得の公式Web資料： [OpenAI料金](https://openai.com/api/pricing/)、[画像生成](https://developers.openai.com/api/docs/guides/image-generation)、[サービス契約](https://openai.com/policies/services-agreement/)、[APIデータ](https://developers.openai.com/api/docs/guides/your-data)、[Google料金](https://ai.google.dev/gemini-api/docs/pricing)、[画像生成](https://ai.google.dev/gemini-api/docs/image-generation)、[利用条件](https://ai.google.dev/gemini-api/terms)、[BFL料金](https://docs.bfl.ai/quick_start/pricing)。リンク先本文を読めたとは記録していない。
