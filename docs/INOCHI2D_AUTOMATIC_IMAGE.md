# 実画像からのInochi2D自動準備

更新日: 2026-10-22。作業ブランチ: `feature/automatic-inochi-character`。

後続の実画像検証では、再添付画像からの無操作の5役割/モデル生成、公式Creatorの読込・保存・新プロセス再読込に成功した。最新の結果は[INOCHI2D_REAL_IMAGE_VALIDATION.md](INOCHI2D_REAL_IMAGE_VALIDATION.md)。下の「元画像がない」記述は2cc9a95時点の初期記録として残す。見た目の完成品質は引き続き未合格。

## 着手時の確認

HEADは`560c6c8b866ae6bd8cd2b13c70f69e995643058a`。GitHubの`research/inochi2d-feasibility`も同じ値で、その他のローカル開発ブランチはすべてこの履歴に含まれる。mainはREADMEだけの段階で未統合。新ブランチ上の開発途中のadapter/UIファイルは保持して進める。元の最小生成器に差分はない。

AGENTS、ROADMAP、PROGRESS、README、INOCHI2D_FEASIBILITYを確認。着手時のビルド・Node・Python・ブラウザ既存テストを実行し、終了時の追加検証と区別して結果を追記する。

## 今回の範囲

正面のアニメ調キャラクター画像1枚から、`face_base`、`eye_white_l`、`eye_white_r`、`eye_closed_l`、`eye_closed_r`を準備する。`l/r`は本人基準なので、正面では本人の左が画像の右になる。ユーザーの点・枠指定や検証用に手で調整した素材を自動化の根拠にしない。

閉眼は入力画像から推定した輪郭を使う局所補完を検証する。透明なダミー画像・固定サンプルへ置換せず、顔/目の検出や補完の失敗は理由付きで返す。画像にない絵の自然さは別途評価する。

```text
元画像 → 自動顔/目検出 → 元座標での所有領域分割・肌下地補完・閉眼補完
                      → 5役割PNG + 配置manifest
                      → 既存の最小Inochi2D生成器 → INP/INX
```

画像処理と変換は独立モジュールへ追加し、既存SAM・素材管理・作業ZIP・Live2D試験経路を維持する。前段で着手した多役割adapterとUIも独立したまま保存するが、今回の合格根拠は5役割の経路とする。

## 変更する場所

| 対象 | 目的 |
|---|---|
| `server/inochi_preparation.py`、専用試験/準備スクリプト | 点・枠を求めない画像準備、検出失敗、座標/alpha/由来の記録 |
| `scripts/inochi2d/`内の接続モジュール | 既存manifestへの変換と元の最小生成器への接続 |
| `server/inochi_api.py`、`server/app.py`のrouter接続 | 一時領域での処理、サイズ/同時数制限、終了後の後片付け |
| `src/inochi-model-panel.js`、main/CSSの接続 | 明示した生成開始・中止・再試行・ダウンロード、既存作業を保持 |
| `scripts/inochi2d/character-model.mjs` | 前段で着手した多役割変換を独立保存。旧最小生成器は変更しない |
| 開発ルール/計画/進捗/READMEと検証資料 | 再開手順、実行条件、成功と未達の区別 |

## 判定

| 判定 | 必要な証拠 |
|---|---|
| ファイル生成 | 同じ元画像から無操作で5PNG/manifest/INP/INX、元の座標・左右・透明度・textureの対応が正しい |
| 公式Creator動作 | 対象ファイルのSHA付きで公式Creator0.8.6の読込、左右独立瞬き、移動、保存と新プロセス再読込を実操作 |
| 見た目の品質 | 元画像との中立時比較、閉眼/途中の線・瞳残像・穴・左右の取り違えを拡大して確認 |

現時点の最小図形モデルのCreator成功を、新しい実画像モデルの成功へ流用しない。Inox2Dの0値/透明度問題は既知の別課題とし、epsilon置換などを生成器へ混ぜない。Cubism/VTube Studio互換の判定はしない。

## データの扱い

画像はローカル計算のみ。元画像/PNG/モデル/スクリーンショットはGitHubへ保存せず、コードと画像を含まない検証記録だけ保存する。有料API契約、外部画像送信、公開、main統合は今回行わない。検証画像を含む`/tmp`の保持は保証されないため、必要な成果物はオーナーが端末へ保存する。

## 実行結果

2026-10-22、Linux/CPU、Node24、Python3.12、Chromiumで確認。GitHubの全ブランチを取得して比較し、560c6c8に含まれない既存開発コミットはなかった。既存の最小model/generate/testへの差分0。入力画像/モデルをGitに追加していない。

| 確認 | 結果と範囲 |
|---|---|
| ビルド | `npm run build`成功 |
| Node | 旧最小7件＋独立研究adapter6件＋既存モデル関連30件＝43件成功 |
| Python | 旧API12件＋自動準備11件＋新API/worker12件＝35件成功 |
| ブラウザ | 既存135件＋新パネル5件＝140件成功。通信代替を含み、実機スマホや実画像の品質試験ではない |
| 依存 | `pip check`成功、既存NumPy2.5.2維持。追加model準備スクリプトの既存ファイルSHA確認に成功 |
| 自作素材での接続 | 5PNG/manifest→旧CLI→INP/INXを生成。画像準備の単体試験は顔検出だけを注入しているため、完全自動の成功には数えない |
| 通常表示の再構成 | 自作試験素材で、切り出し前景とRGBA完全一致。本人左/右、元座標、PNG寸法、入力不変、目以外のalpha128、推論alpha254から元の目alpha255への復旧を確認 |
| 失敗時 | 目なし/既に閉じた薄線/閉眼輪郭の抽出不能/元の目が半透明/不正画像/サイズ超過は拒否。実子プロセスの中止・時間切れ・切断と一時画像の削除を確認 |
| 公開の追加実絵 | `waifu2x/images/miku_small.png`（228×159、斜め顔、CC BY-NC表記）を無変更でローカルAPIへ送信。目検出失敗で422、0.219秒、モデルなし、busy解除。対応成功例に数えない |
| 背景除去のみの実推論 | 同じ参考画像で固定BiRefNetを直接実行し13.335秒。見える画素の元RGB一致、alpha0のRGBゼロを確認。背景除去だけの試験で、目分離/モデルの成功ではない |
| 元の提供画像 | 元JPEGと前の/tmp検証素材が環境更新で消失。再添付が必要 |
| 今回の実画像モデルの公式Creator | **未検証**。対象モデルが未生成。前回の図形モデルの成功を流用しない |
| 見た目の品質 | **未合格**。元の実画像との再構成、閉眼・途中の見た目を確認できていない |

最初のブラウザ全体試験は135件中133件成功・2件timeout。コード編集中の実行だったため、対象5件を単独で再実行して成功を確認し、変更固定後の全140件も成功した。初回失敗を隠さず、最終結果と区別する。Starlette/httpxの非推奨通知はあるが試験は成功。大きなテスト用の自作画像は、その都度コードから作成してGitには保存しない。

## 保存する変更ファイル

| 分類 | ファイル |
|---|---|
| 自動画像準備 | `server/inochi_preparation.py`、`server/requirements-inochi.txt`、`scripts/download_animeface.py`、`scripts/download_inochi_models.py` |
| API接続 | `server/inochi_api.py`、`server/inochi_worker.py`、`server/app.py`（router追加のみ） |
| 画面 | `src/inochi-model-panel.js`、`src/main.js`（接続7行）、`src/style.css` |
| 追加試験 | `server/test_inochi_preparation.py`、`server/test_inochi_api.py`、`tests/inochi-model.spec.js` |
| 前段の独立研究成果 | `scripts/inochi2d/character-model.mjs`、`scripts/inochi2d/character-test.mjs`（今回APIから未使用） |
| 記録 | `AGENTS.md`、`ROADMAP.md`、`PROGRESS.md`、`README.md`、本資料、`docs/INOCHI2D_FEASIBILITY.md`、`docs/INOCHI2D_LICENSE_AUDIT.md`、`docs/INOX2D_KNOWN_ISSUES.md` |

## 実装の性質と残る問題

- 前処理は既存評価済みBiRefNetのONNX/正規化を再利用し、OpenCVの顔検出と画像処理を組み合わせる。通常の手動SAM APIを変更せず、手動SAMを全自動成功に数えない。元画像のRGBを使い、背景推定のalphaを組み合わせる。
- 顔・目の探索には正面/単独/両目開きの制限がある。小さい顔、片目隠れ、暗い髪と瞳の連結等で検出に失敗しうる。現在、実絵の成功率を示せる検証集合はない。
- `eye_white_l/r`は既存の役割名を使うが、現段階では白目だけでなく目と周囲の小さな矩形パッチを含む。閉眼は元の上まつ毛のインクを曲線へ移した推定で、生成AIによる隠れた解剖形状の復元ではない。肌下地はTelea補完。自然さは未確認。
- 目の元alphaが255以外なら拒否する。推定背景alphaだけが254等の場合は、目の領域に限り元画像の255へ戻し、変更画素数を記録。目以外のalphaと元RGBは保持し、抽出前景と通常合成のRGBA一致を必須にする。この一致は元の背景まで含む画像全体の一致や、閉眼の品質を意味しない。
- `face_base`には目以外の前景も含める。旧5役割テンプレートのHeadXは前景全体の平行移動と傾きで、頭だけの移動や独立HeadTiltではない。眉・口・髪を分ける後続作業は今回の成功条件へ混ぜない。
- APIの生成時間上限は150秒、同時1件。各素材2048px/PNG8MiB、合計RGBA16MiB、最小モデル32MiBの旧上限を維持。自動縮小は行わない。
- 多役割`character-model.mjs`と6テストは前段の成果を保持する独立研究コード。今回のUI/APIからは呼ばず、公式Creatorでの検証も未実施。

## 再実行

依存と固定モデルの準備・サーバー起動はREADMEのInochi2D欄を参照。モデルの取得は明示したsetupスクリプトだけで行い、生成リクエストやstatusでは取得しない。入力が用意できたら次のコマンドで一連の結果を端末へ保存できる（ローカル開発サーバーが起動済みの場合）。

```sh
curl --fail-with-body -H 'Content-Type: image/jpeg' \
  --data-binary @/path/to/character.jpg \
  http://127.0.0.1:8000/api/inochi2d/generate \
  --output /tmp/inochi2d-character.zip
```

失敗時の応答はJSONなので、ZIPであることとHTTP結果を確認してから展開する。私用試験素材は`/tmp/inochi2d-character-trial/`。顔検出を注入した単体素材は`preparation-unit-fixture-v2`と明記し、原画像の代用にしない。公式Creator本体は再取得してSHAを過去記録と照合したが、新しい実画像モデルの動作確認はしていない。

## 次に必要な作業

1. 元のキャラクター画像を再添付し、無変更の入力から完全自動で5役割/manifest/モデルを生成する。失敗したらその検出/補完原因を改善する。
2. 元画像・背景除去後・通常モデルの再構成と、左右の閉眼/途中の線・瞳残像・肌の穴を同じ倍率で確認する。
3. 対象モデルのSHAを固定し、公式Creator0.8.6で読込・左右独立の0/途中/1・HeadX・保存・別プロセス再読込を行い、スクリーンショットと検証reportをGit外へ保存する。
4. 対応例を増やし、成功率/失敗理由/処理時間を測る。Inox修正、スマホ実機、Cubism/VTube Studio互換、配布/公開は別の判定として管理する。
