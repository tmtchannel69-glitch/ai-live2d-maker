# 自動生成したInochi2Dモデルを画面で確認する

2026-10-25。詳細な頭・首・胴体モードの結果確認を追加。モデルの生成・リギングは既存の処理を保ち、既存の独立CPU診断の比較画像と共通パーツを画面へ接続した。実時間のモデル再生や公式ランタイムの導入ではない。

## 操作

1. 「画像から変換」で画像を選び、画像欄の「この画像から自動モデルを作る画面へ」を押す。画面の移動だけでは画像を送らない。
2. 「頭・首・胴体を分ける（実験）」を選ぶ。画像なしの準備確認で、不足ライブラリ・重みを調べられる。自動ダウンロードは行わない。
3. 生成ボタンを押すと、このPC/クラウド環境内のローカルAPIで自動処理する。第三者の画像APIを使わず、点・枠・手動リギングを必要としない。
4. 完了すると通常状態を表示する。「確認する動き」で、胴体を固定した頭の移動・傾き10状態、目元の開閉10状態を切り替える。スライダー/前/次/「比較画像を順に表示」で確認する。
   新しい詳細結果では、目元の同じ開度で「肌の境界調整の前後」も切り替えられる。肌の色差/ぼけ候補を別に表示する。[補正の範囲と再生成](SKIN_BOUNDARY_CORRECTION.md)。
5. 「分離したパーツと補完領域を確認」を開く。役割と本人左右、元画像の位置、親、重なり順、分離画像/補完画像を確認できる。補完がない場合はその旨を示し、ダミーを置かない。
6. 「生成済みのモデルZIPを保存」でモデル/生成パーツ/設定/レポート/比較画像をまとめて保存する。`model.inp`または`model.inx`を公式Inochi Creator0.8.6で開く。

次回は「保存したモデルZIPを開いて確認」から同じZIPを選べばよい。元画像や生成サーバーへの接続なしに、端末内で比較画像とパーツを表示する。ファイルはアップロードせず、モデルも再生成しない。**作業保存ZIPや33パーツ生成ZIPは、この入口と別形式**。従来5パーツ/旧詳細ZIPはモデルを保存できるが、含まれない比較画像を作ったことにはせず、表示できない理由を示す。

画面だけでは永続保存されない。閉じる前にZIPを端末へ保存する。クラウド内のlocalhostはWindows/iPhoneのlocalhostとは異なる。公開URLは作らず、起動・依存の準備は[詳細モードの手順](DETAILED_INOCHI_APP_MODE.md)を使う。

## 表示と検証の区別

- 画像は実際に出力した`head/model.inp`のシリアライズ済みパラメータ・メッシュから、既存の独立CPU描画器が描いたもの。公式Creatorの画面写真やInox2Dの動作とは呼ばない。限定したNormal/stencil方式の診断で、任意モデル対応ランタイムではない。
- 頭の比較は全キャンバスを最大640pxへ縮小した10姿勢。小さいHeadXの平面移動とHeadTiltのZ傾きで、胴体を固定する。顔の立体的な角度X/Yや全身リギングではない。
- 目の比較は元解像度の目元切り出し（最大640px）。開度0/.025/.05/.075/.1/.15/.25/.5/.75/1の両目同時10状態。左右の目を独立に操作する画面や連続リギングの再生ではない。左右独立のnativeパラメータは維持する。
- 連続表示は離散画像を400msずつ順に切り替えるだけで、補間の自然さを証明しない。最初は静止し、画面を隠す/画像を変える/次の処理を始めると止める。
- 穴/残像/二重線/胴体の差の値は候補検査。首の内側と胴体は診断レポート指定のROIだけを調べ、画像全域の品質保証にはしない。ROIと各状態の検査値はZIPのJSONに残す。
- `ファイル生成`、`公式Creatorの動作`、`自然な見た目`を別表示する。画面で表示できても、今回の出力のCreator検査を自動で合格にせず、見た目も未合格とする。
- 肌のぼけ、閉眼線・髪・襟の境界、隠れた形や毛束の前後関係、他画像での成功率は未解決。Inochi2D legacy0.8.6用で、Cubism/MOC3/VTube Studio互換の出力ではない。

## 実装と保存形式

| ファイル | 役割 |
| --- | --- |
| `server/inochi_review.py` | 頭10枚/目元10枚、補正時は前の目元10枚も固定リストで読み、RGBAを保って縮小。描画・生成のアルゴリズムを変えない |
| `server/inochi_detailed.py` | 比較画像/レポートをモデルZIPへ追加。モデル/パーツの既存allowlistと上限を維持 |
| `src/inochi-model-review.js` | ZIPの事前索引検査、分割した展開、中止、モデル指紋/比較情報/PNG寸法/配置の確認 |
| `src/inochi-model-review-panel.js` | 動きの比較、検査候補の表示、パーツ/補完の確認、画像URLの解放 |
| `src/inochi-model-panel.js` | 画像欄からの入口、生成結果の検査後反映、端末内ZIPの開き直し |
| `scripts/inochi2d/verify-app.mjs` | 実画像のAPI生成/中止/再試行/保存と20表示のバイト照合、元画像なしの再読込を再現 |

新しい詳細ZIPの`generation-report.json`は版2。`containsUploadedOriginalFile:false`、`containsPreparationReconstruction:false`、`containsModelRenderedComparisons:true`と`reviewManifest:review/review.json`を記録する。旧版1も読める。旧`containsOnePieceReconstruction`の曖昧な表現は新しい版では使わない。**元のアップロード画像と準備時の一枚再構成は含めないが、モデルから描画した全体比較画像は含む**。

`review/review.json`は`ai-live2d-maker-model-review`版1。`renderer`、対象`model.inp`のSHA256、元のサイズ、head/blinkの表示サイズ/ROI、20フレームのファイル/パラメータ/診断を記録。パーツの役割・位置・親・順・分離/補完PNGは既存`common/parts.json`をそのまま使う。画像を元座標から書き換えず、確認用画像だけを縮小する。

現在は肌境界の前後比較がある場合だけreview版2を使う。目元の10frameに`before_file`/`before_diagnostics`と、境界調整レポートへの参照を追加する。旧版1も読める。全20状態に補正前目元10枚を加えた30枚で、頭部の前後比較を自動で追加したとはしない。

読み込み上限は圧縮後/展開後80MiB・256項目。中央索引を展開前に調べ、危険なパス/重複/未知圧縮方式/過大なサイズを拒否する。4KiB単位の圧縮データを展開して実際の出力も申告値/上限と照合し、128KiBごとに画面へ制御を返して中止可能にする。PNGは最大8MiB、パーツは元入力と同じ各辺4096/16M画素まで。モデル指紋は整合性検査であり、出典の認証ではない。PNGはブラウザに表示し、ZIPのコードを実行したり端末へ自動展開したりしない。

読み込み/新しい生成が失敗・中止した場合、元の作業と前回のモデル/比較画像を保持する。次の結果が検査を通った後でだけ置換する。元画像の変更/リセットでは古い結果を解放する。

## 再検証

新しい契約・外部画像送信・モデル取得は不要。既存の依存と重み、提供した元画像が必要。依存不足は[準備手順](DETAILED_INOCHI_APP_MODE.md)で明示し、黙ってダウンロードしない。

```sh
node --test scripts/inochi2d/app-review-test.mjs
.venv/bin/python -m pytest server/test_inochi_detailed.py -q
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test tests/inochi-review.spec.js tests/inochi-detailed.spec.js tests/inochi-model.spec.js tests/workflow-navigation.spec.js
# ローカル画面/APIを起動してから、Git外の新しい出力先へ保存する
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium node scripts/inochi2d/verify-app.mjs --source /path/to/original-character.jpg --output /tmp/NEW-model-review-check --url http://127.0.0.1:5180
npm run build
```

合成した小さいテストfixtureは入出力/安全制限の検査用で、動作モデルやAI生成の成功例ではない。実画像のモデル/ZIP/画面はGit外だけに保存する。実測は[検証結果](INOCHI_MODEL_REVIEW_VALIDATION.md)に記録する。
