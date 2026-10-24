# OpenAI画像生成：実行前の技術検証計画

この文書は1988679の旧6request準備の記録。現在の既定は[2.5を含む比較と2回試験](OPENAI_IMAGE_TWO_CALL_PILOT.md)へ更新した。旧準備は`--legacy-six-call`、旧単価statusは`pricing-status-v1.json`で保持する。以下の6/12回は現行の試験枠ではない。

2026-10-24。基準は`08c0edd`、新しい作業ブランチは`feature/openai-image-pilot-preparation`。オーナーが承認したのは仕様/料金の調査、共通参照方式と少数パーツの試験準備。**有料API実行、文章/画像のAI送信、新契約は未承認。今回のコードには送信機能もキー読取もない。** main統合/公開を行わない。

## モデル・公式仕様・料金の確認状況

| 項目 | 確認した内容 |
| --- | --- |
| 第一試験候補 | `gpt-image-1.5`。参照画像/透過/`input_fidelity=high`を公式SDKで確認できるため。最新/最良という品質評価ではなく、アカウントの利用可否も未確認。これはaliasで、固定snapshotではない |
| 他のSDK掲載モデル | `gpt-image-2.5-sunburst-2026-09-08`等。SDKに透過/サイズの記載はあるが、現行料金・品質・モデルごとの参照保持の実測は未確認。自動採用しない |
| 共通参照の作成 | `POST https://api.openai.com/v1/images/generations`、JSON、文章のみで1画像 |
| 共通参照からパーツ | `POST https://api.openai.com/v1/images/edits`、multipart、`image[]`に同じ参照と部品の配置ガイドを添付 |
| 初期パラメータ | `n=1`、`1024x1024`、`quality=medium`、`background=transparent`、`output_format=png`。editだけ`input_fidelity=high`。`auto`/stream/旧`response_format`は使わない |
| 入出力の公式SDK記載 | GPT Imageはbase64応答、編集入力は最大16画像/各50MB未満、PNG/WebP/JPG。任意の透過層や正確な座標を保証する契約ではない。pilotは2画像/8MiB以下のPNGに制限 |
| マスク | 今回は添付しない。将来使う場合は最初のimageに適用、同じ寸法の4MB未満PNG、alpha0が編集領域。マスクでも完全固定は保証されない |
| 現行の公式料金・契約 | **未確認**。料金/ガイド/API資料/データ/契約WebへのGETは接続proxyのCONNECT403。proxyを使わない公開GETもDNS失敗。API実行で接続確認していない |

確認元は[公式Python SDKの固定718aee9](https://github.com/openai/openai-python/tree/718aee979a9c334d37302aeff21cee6cbff4d43c)。[generate型](https://github.com/openai/openai-python/blob/718aee979a9c334d37302aeff21cee6cbff4d43c/src/openai/types/image_generate_params.py)、[edit型](https://github.com/openai/openai-python/blob/718aee979a9c334d37302aeff21cee6cbff4d43c/src/openai/types/image_edit_params.py)、[実ルート](https://github.com/openai/openai-python/blob/718aee979a9c334d37302aeff21cee6cbff4d43c/src/openai/resources/images.py)。調査時のmainの型ファイルも同じ内容だった。SDKの対応型やApache2はモデルの利用権/料金/データ保管契約の確認にはならない。

[公式cookbook](https://github.com/openai/openai-cookbook/blob/8495326b6f1b7cec94e7f5e393a4045e328a268e/examples/Generate_Images_With_GPT_Image.ipynb)の参照/マスクの考え方も確認。ただし古いGPT Image 1の例で、入力上限10枚の記述など現SDKとの差がある。古い例を現行価格や全モデルの仕様として使わない。画像サンプルを作品素材へ流用しない。

未取得の公式Web：[料金](https://openai.com/api/pricing/)、[生成ガイド](https://developers.openai.com/api/docs/guides/image-generation)、[Images API](https://developers.openai.com/api/reference/resources/images/)、[APIデータ](https://developers.openai.com/api/docs/guides/your-data)、[サービス契約](https://openai.com/policies/services-agreement/)。取得失敗と単価nullは`server/ai-image-pilot/pricing-status.json`へ記録した。ChatGPTの利用プランとAPI課金は別に確認する。

## 実行前に提示する費用

| 見積の項目 | 今回の状態 |
| --- | --- |
| text input / image input / image output単価、medium 1024正方形の出力料金 | すべて未確認、数値をnullで保存 |
| 試験1回の通常回数 | 参照1回＋5パーツ各1回＝6リクエスト、6出力。partごとに参照1枚＋ガイド1枚、計10画像添付 |
| 再試行込みの回数上限案 | 各jobの追加試行を1回までとして最大12リクエスト/12出力/20画像添付。SDK自動retryは将来も0に設定する |
| 通常の推定USD | 算定待ち。`C(参照1回) + 5×C(部品edit1回)`。入力の文章/2画像/出力を含める |
| 最大の推定USD | 算定待ち。`2×C(参照1回) + 10×C(部品edit1回)`。キャッシュ割引を前提にしない。部品ごとのusage差があれば各費用を別に合計 |
| 現在許可されている実行・費用 | **0回 / 0 USD**。12回は提案した試験枠であり、承認でも金額上限でもない |

単価を記憶や第三者の推測で埋めず、現在の公式表、実モデル/解像度/品質の出力額またはtoken課金、入力usageの算定方法を確認してから見積もる。上記の回数だけでは実課金の硬い上限にならない。調べたImagesパラメータにはUSD上限の指定がなく、実行後のusageだけで先行リクエストの課金を止められない。アカウント側の支出設定の効き方/反映遅延も確認してから、十分な余裕を含む試験予算と停止条件を提示する。

タイムアウト/失敗も送信済みなら課金された可能性がある。自動再送せず試行枠へ計上し、二重送信を防ぐ。参照を作り直すと全パーツの条件が変わるので、新試験として費用と全パーツを計画し直す。無限再試行や無料の再生成と扱わない。

## 共通参照からの5パーツ

1. 既存の`createDesignPlan`で髪/目/顔/衣装/雰囲気、共通パレット/線/陰影、33役割の座標/支点/接続を作る。画像はまだ作らない。
2. 文章と座標指定から正面/胸上/通常顔/メイドの共通デザイン1枚をAIで生成する予定。以前のユーザー画像は添付しない。参照の透過・同一性・顔/目/首の位置が不適合なら次へ送らない。
3. 実際の参照PNGのSHA256を固定し、全partに**同じ実バイト**を添付する。毎回の独立した顔生成や参照の差し替えを避ける。
4. `face_base`、`bangs_front`、`eye_white_l`、`iris_l`、`eyelashes_l`を各1枚の完全なRGBAレイヤーとして生成する予定。lは本人の左/画面の右。初回は片目の分離を試す範囲で、左右まばたき完成とはしない。
5. 各editのimage1は共通参照、image2は青い矩形/マゼンタの支点だけの技術ガイド。ガイドをコピーせず、対象以外を透明にし、隠れた肌/髪根元/虹彩も完全に描くよう文章で指定する。ガイドに生成済みの顔などは含まれない。

APIの1024×1024へ、元の768×1024をx+128/y+0で配置する。拡大縮小/縦横比の変更はしない。部品ごとの自動recenterや見切れ補正はしない。APIの対応外の768×1024をaliasモデルへ送る前提を避ける。自由形状の技術検証の前に、この制約付き試験で参照保持/透過/座標を調べる。

送信予定の文章の**全文とAPI fields/添付名**は[既定デザインのレビュー資料](OPENAI_IMAGE_PILOT_PAYLOADS.md)。別デザインではprepareを実行し、そのデザインの`requests/*.json`を再提示する。文章は共通デザイン/色/スタイル/配置と、対象layerとhidden面を描く指示。送信画像は、承認後に得た共通参照と自作の技術図のみ。既存ユーザーの絵・モデル・ZIP・秘密鍵は含めない。既定文章の保存やファイルの手動編集を、送信承認として扱わない。

## 品質判定と33パーツへの拡張

- **構造**：期待する1024正方形/8bit RGBA、空でない、切り出すtile自体に透明部分がある、指定tile外の可視画素0。tileへ切り出して元位置/straight RGBA/透明RGBを保持。範囲外の画素を消して合格にしない。
- **参照と絵の一貫性**：髪/肌/瞳の色と陰影、線幅/先細り、顔と虹彩の同一性を確認。青/マゼンタのガイド残り、描かれた市松模様、別の顔/目、瞳やまつ毛の混入を確認する。PNGが透明でも意味的な部品として正しいとは限らない。
- **hidden面と接続**：髪の下の額、目の下の肌、髪根元、瞼下の完全な虹彩を露出させ、元参照との境界と接続を比較する。自動矩形検査だけで自然さ/補完合格にしない。
- **目の拡張後**：左右それぞれの白目/虹彩/ハイライト/上下瞼/まつ毛/眉を同じ参照で生成し、10開度で二重線/残像/穴/肌ぼけを検査。閉眼素材/中間状態が未生成の初回5パーツを、この項目の成功にしない。
- **33役割の完成後**：耳、口/口内、残りの髪/首/胴体/服の層を同じ参照から生成。重なりと隠れた面、頭の移動/傾きで首や髪に穴が出ないことを確認する。別デザインを最低3例で再試験する。

今回実装した検査は最初の構造だけ。色/線/隠れ面のAI画像での実測は未実施。構造に合う1画素やガイド画像さえ矩形検査は通り得るため、`appearance_quality_passed`とAI出典は常に未合格として返す。AI生成成功率、ファイル生成、Creator動作、完成品品質を別々に報告する。

既存manifest版1/版2はテンプレート/端末内描画だけを受ける。**AIを版2の`local-design-v1`や`ai_generated:false`へ偽装して通さない。** 5パーツをテンプレート28枚で埋めて完全AIモデル成功とも扱わない。

33枚が揃い品質を確認できた後、AI専用の出典付きmanifest adapter（新version/明示provider）を追加する計画。サーバーで実request/response ID、model、usage、参照/PNGのSHA、補完と生成の区別を記録し、同じ33役割/座標/親/順/支点/rig_geometryへ変換する。共通の形状検査/合成/`buildLayeredInochi`相当の内部処理へ別の検証済み入口を設け、既存のmesh/blink/mouth/neck/legacy serializerを再利用する。自由に変わった座標の推定や一般的なAI絵のまつ毛検出は別の検証項目。対応できない絵を固定templateで隠さない。

最後に新しいモデル自身を公式Creator0.8.6で読み込み/動作/保存/新プロセス再読込する。今回の準備に過去の公式Creator合格を流用しない。Cubism/VTube Studio互換やINP2対応を表示しない。

## APIキーと将来の接続

ブラウザからは自前の認証済みbackendへ要求を送り、backendだけがOpenAIへ接続する。現在のFastAPIへ承認後に別router/workerを追加する計画で、今回routerは登録しない。Nodeの共通plan作成とPythonの将来のproviderを分離できる。OpenAI SDKはまだ依存へ追加しない。

キーはサーバーのsecret管理/`OPENAI_API_KEY`だけに置く。`VITE_*`、ブラウザ配信、JSON/manifest、URL、CLI引数、Git、通常ログ、会話へ値を貼る方式は使わない。開発用`.env*`はGit除外したが、これは本番のsecret管理の代替ではない。専用API project/最小権限、支出設定、停止/ローテーションを実行前に確認する。SDK導入時はbase URLを公式へ固定し、SDKの自動retryを0にしてrequest台帳とusageをサーバーで記録、エラーからキー/画像base64を除去する。

モデル契約、生成画像の利用条件、入力素材の権利、保管/学習/削除/地域、アカウント本人の利用可能性は事前確認する。SDKライセンスで代用しない。user画像の外部送信を許可していない今回、過去画像を参照へ自動追加しない。

## 今回のファイルと再現

- `server/ai-image-pilot/plan.mjs`：共有デザインを再利用した6request/費用の式/0実行/参照固定の契約。`pricing-status.json`へ取得失敗とnull単価。
- `guides.mjs`/`quality.mjs`：技術図だけのPNGと、実行後に使える座標/RGBA検査。AIとしての品質/出典を自己認定しない。
- `scripts/ai-image-pilot/prepare.mjs`：全文JSON/5PNG/実行前確認書をGit外へ保存。`check-parts.mjs`：別途承認後の出力を検査する準備用CLI。
- 既存のフロント画面、template/33部品、manifest版1/2、Inochi生成器、画像1枚からのAPIを変更しない。新しい有料依存/キー/ルート/実送信は追加しない。

```sh
npm ci
# ブラウザやAPIキーなしで準備。出力先は存在しないGit外ディレクトリ。
node scripts/ai-image-pilot/prepare.mjs --output /tmp/NEW-openai-pilot
# デザイン指定の例。APIは実行しない。
node scripts/ai-image-pilot/prepare.mjs --design /path/to/character_design.json --output /tmp/NEW-openai-design
# 承認後の実験でrawに5枚が揃った時だけ。AI出典/自然さの認定やモデル化はしない。
node scripts/ai-image-pilot/check-parts.mjs --plan /tmp/NEW-openai-pilot/pilot_plan.json --input /tmp/NEW-openai-pilot/raw --output /tmp/NEW-pilot-review
node --test scripts/model-build/test.mjs scripts/model-build/*.test.mjs scripts/inochi2d/*test.mjs scripts/character-generation/*test.mjs scripts/ai-image-pilot/*test.mjs
```

APIを実行するコマンドや`--execute`は存在しない。既存ディレクトリへの上書きと、symlinkを経由した当リポジトリ内への画像出力を拒否。入力/生成/比較の画像・モデル・ZIPはGit外に保持し、ソース/再生成設定/公開資料の出典だけを作業ブランチへ保存する。

試験を実行する前の未充足条件は、最新の公式価格と入力課金の確認、通常/最大USDの見積もり、モデル/保存と利用条件の確認、実際の文章/画像のオーナー承認。その後に初めて限定した送信adapterを実装・実行する。現在の金額は推測で埋めず、APIを呼ばずに保留する。
